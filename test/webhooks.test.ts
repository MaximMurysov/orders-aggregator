import { describe, expect, it } from "vitest";
import { apiOrder, postWebhook, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /webhooks/order", () => {
  it("stores the actual payment rather than recalculating the percentage", async () => {
    const o = apiOrder({ amount: "1.13", discountPercent: 10, amountPaid: "1.01" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "created" });
    const saved = await ctx.db.query(`SELECT amount_kop, amount_paid_kop FROM orders WHERE id = $1`, [o.id]);
    expect(saved.rows[0]).toEqual({ amount_kop: "113", amount_paid_kop: "101" });
  });

  it.each([
    { discountPercent: -1 }, { discountPercent: 101 }, { discountPercent: "10" },
    { discountPercent: 10 }, { amountPaid: null }, { amountPaid: "" },
    { amountPaid: -1 }, { amountPaid: 1001 }, { amount: "90071992547409.92" },
  ])("rejects invalid discount/payment %j without writing", async (over) => {
    const o = apiOrder(over);
    expect((await postWebhook(ctx.app, o)).statusCode).toBe(400);
    const saved = await ctx.db.query(`SELECT id FROM orders WHERE id = $1`, [o.id]);
    expect(saved.rows).toEqual([]);
  });

  it.each(["pending", "paid", "refunded"])("accepts a full discount for %s", async (status) => {
    const o = apiOrder({ status, discountPercent: 100, amountPaid: 0 });
    expect((await postWebhook(ctx.app, o)).statusCode).toBe(200);
    const saved = await ctx.db.query(`SELECT amount_paid_kop FROM orders WHERE id = $1`, [o.id]);
    expect(saved.rows[0].amount_paid_kop).toBe("0");
  });

  it("concurrent duplicate deliveries create exactly one order", async () => {
    const o = apiOrder({ amount: 19.99, discountPercent: 25, amountPaid: 14.99 });
    const responses = await Promise.all(Array.from({ length: 8 }, () => postWebhook(ctx.app, o)));
    const results = responses.map((r) => r.json().result);
    expect(results.filter((r) => r === "created")).toHaveLength(1);
    expect(results.filter((r) => r === "stale")).toHaveLength(7);
    const saved = await ctx.db.query(`SELECT amount_kop, amount_paid_kop FROM orders WHERE id = $1`, [o.id]);
    expect(saved.rows).toEqual([{ amount_kop: "1999", amount_paid_kop: "1499" }]);
  });

  it("a waiting older writer cannot overwrite a concurrent newer version", async () => {
    const o = apiOrder({ amountPaid: 900 });
    await postWebhook(ctx.app, o);
    const lock = await ctx.db.connect();
    const pending: ReturnType<typeof postWebhook>[] = [];
    const waitForWriters = async (count: number) => {
      for (let attempt = 0; attempt < 100; attempt++) {
        const { rows } = await ctx.db.query(
          `SELECT count(*)::int AS n FROM pg_stat_activity
           WHERE datname = current_database() AND wait_event_type = 'Lock'
             AND query LIKE 'INSERT INTO orders%'`,
        );
        if (rows[0].n >= count) return;
      }
      throw new Error(`expected ${count} blocked order writers`);
    };
    try {
      await lock.query("BEGIN");
      await lock.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [o.id]);
      pending.push(postWebhook(ctx.app, { ...o, amountPaid: 700, status: "refunded", updatedAt: "2026-02-12T00:00:00Z" }));
      await waitForWriters(1);
      pending.push(postWebhook(ctx.app, { ...o, amountPaid: 800, updatedAt: "2026-02-11T00:00:00Z" }));
      await waitForWriters(2);
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
      await Promise.all(pending);
    }
    expect((await pending[0]).json()).toEqual({ result: "updated" });
    expect((await pending[1]).json()).toEqual({ result: "stale" });
    const saved = await ctx.db.query(`SELECT amount_paid_kop, status FROM orders WHERE id = $1`, [o.id]);
    expect(saved.rows[0]).toEqual({ amount_paid_kop: "70000", status: "refunded" });
  });

  it("an equal or older version cannot change money, status or ownership", async () => {
    const o = apiOrder({ amountPaid: 800, discountPercent: 20 });
    await postWebhook(ctx.app, o);
    for (const updatedAt of [o.updatedAt, "2026-02-09T12:00:00Z"]) {
      const response = await postWebhook(ctx.app, {
        ...o, amount: 500, amountPaid: 0, status: "refunded", customerId: "other", updatedAt,
      });
      expect(response.json()).toEqual({ result: "stale" });
    }
    const saved = await ctx.db.query(`SELECT amount_kop, amount_paid_kop, status, customer_id FROM orders WHERE id = $1`, [o.id]);
    expect(saved.rows[0]).toEqual({ amount_kop: "100000", amount_paid_kop: "80000", status: "paid", customer_id: "c_1" });
  });

  it("hydrates a migrated order once at the same version and rejects older hydration", async () => {
    const o = apiOrder({ amountPaid: 800, discountPercent: 20 });
    await ctx.db.query(
      `INSERT INTO orders (id, customer_id, amount_kop, status, created_at, updated_at)
       VALUES ($1, $2, 100000, 'paid', $3, $4)`,
      [o.id, o.customerId, o.createdAt, o.updatedAt],
    );
    expect((await postWebhook(ctx.app, { ...o, updatedAt: "2026-02-09T12:00:00Z" })).json()).toEqual({ result: "stale" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "updated" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
    const saved = await ctx.db.query(`SELECT amount_paid_kop FROM orders WHERE id = $1`, [o.id]);
    expect(saved.rows[0].amount_paid_kop).toBe("80000");
  });

  it("создаёт заказ", async () => {
    const res = await postWebhook(ctx.app, apiOrder());
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ result: "created" });
  });

  it("повтор того же события ничего не меняет", async () => {
    const o = apiOrder();
    await postWebhook(ctx.app, o);
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
  });

  it("устаревшее событие после нового игнорируется", async () => {
    const o = apiOrder({ status: "paid", updatedAt: "2026-02-10T12:00:00Z" });
    await postWebhook(ctx.app, { ...o, status: "refunded", updatedAt: "2026-02-11T12:00:00Z" });
    expect((await postWebhook(ctx.app, o)).json()).toEqual({ result: "stale" });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [o.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("новое событие обновляет заказ", async () => {
    const o = apiOrder({ status: "pending" });
    await postWebhook(ctx.app, o);
    const res = await postWebhook(ctx.app, { ...o, status: "paid", updatedAt: "2026-02-11T00:00:00Z" });
    expect(res.json()).toEqual({ result: "updated" });
  });

  it("невалидное тело — 400", async () => {
    const res = await postWebhook(ctx.app, { id: "x" });
    expect(res.statusCode).toBe(400);
  });
});
