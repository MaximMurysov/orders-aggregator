import { describe, expect, it, vi } from "vitest";
import { apiOrder, setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("POST /sync", () => {
  it("does not overwrite a webhook received while a sync page is in flight", async () => {
    const old = apiOrder({ amountPaid: 900 });
    const fresh = { ...old, amountPaid: 800, status: "refunded", updatedAt: "2026-02-12T00:00:00Z" };
    let releasePage!: () => void;
    let pageRequested!: () => void;
    const pageGate = new Promise<void>((resolve) => { releasePage = resolve; });
    const requested = new Promise<void>((resolve) => { pageRequested = resolve; });
    const spy = vi.spyOn(ctx.api, "getOrdersPage").mockImplementationOnce(async () => {
      pageRequested();
      await pageGate;
      return { items: [old], nextCursor: null };
    });
    const sync = ctx.app.inject({ method: "POST", url: "/sync" }).then((response) => response);
    try {
      await requested;
      const webhook = await ctx.app.inject({ method: "POST", url: "/webhooks/order", payload: fresh });
      expect(webhook.json()).toEqual({ result: "created" });
      releasePage();
      expect((await sync).json()).toMatchObject({ received: 1, applied: 0, stale: 1 });
      const saved = await ctx.db.query(`SELECT amount_paid_kop, status FROM orders WHERE id = $1`, [old.id]);
      expect(saved.rows[0]).toEqual({ amount_paid_kop: "80000", status: "refunded" });
    } finally {
      releasePage();
      await sync;
      spy.mockRestore();
    }
  });

  it("keeps the newest payment across unordered pages and webhook replay", async () => {
    const o = apiOrder({ amount: "19.99", amountPaid: "14.99", discountPercent: 25 });
    const newest = { ...o, status: "refunded", amountPaid: "12.99", updatedAt: "2026-02-12T00:00:00Z" };
    ctx.api.pages.set(null, { items: [newest, { ...o, amountPaid: "bad" }], nextCursor: "p2" });
    ctx.api.pages.set("p2", { items: [o, newest], nextCursor: null });
    const response = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(response.json()).toMatchObject({ received: 4, applied: 1, stale: 2, invalid: 1 });
    expect((await ctx.app.inject({ method: "POST", url: "/webhooks/order", payload: o })).json()).toEqual({ result: "stale" });
    const saved = await ctx.db.query(`SELECT amount_kop, amount_paid_kop, status FROM orders WHERE id = $1`, [o.id]);
    expect(saved.rows[0]).toEqual({ amount_kop: "1999", amount_paid_kop: "1299", status: "refunded" });
  });

  it("проходит все страницы и останавливается на пустой странице с тем же курсором", async () => {
    const [a, b, c] = [apiOrder(), apiOrder(), apiOrder()];
    ctx.api.pages.set(null, { items: [a, b], nextCursor: "p2" });
    ctx.api.pages.set("p2", { items: [c], nextCursor: "p3" });
    ctx.api.pages.set("p3", { items: [], nextCursor: "p3" });

    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ pages: 3, received: 3, applied: 3, invalid: 0 });
    const { rows } = await ctx.db.query(`SELECT count(*)::int AS n FROM orders`);
    expect(rows[0].n).toBe(3);
  });

  it("невалидные заказы пропускает, а не падает", async () => {
    ctx.api.pages.set(null, { items: [apiOrder(), { id: "broken" }, apiOrder({ amount: "abc" })], nextCursor: null });
    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.json()).toMatchObject({ received: 3, applied: 1, invalid: 2 });
  });

  it("не откатывает более свежую версию заказа", async () => {
    const fresh = apiOrder({ status: "refunded", updatedAt: "2026-02-12T00:00:00Z" });
    await ctx.app.inject({ method: "POST", url: "/webhooks/order", payload: fresh });
    ctx.api.pages.set(null, { items: [{ ...fresh, status: "paid", updatedAt: "2026-02-10T12:00:00Z" }], nextCursor: null });

    const res = await ctx.app.inject({ method: "POST", url: "/sync" });
    expect(res.json()).toMatchObject({ stale: 1 });
    const { rows } = await ctx.db.query(`SELECT status FROM orders WHERE id = $1`, [fresh.id]);
    expect(rows[0].status).toBe("refunded");
  });

  it("строковые суммы и даты без зоны", async () => {
    const o = apiOrder({ amount: "2500.00", createdAt: "2026-02-10T21:30:00" });
    ctx.api.pages.set(null, { items: [o], nextCursor: null });
    await ctx.app.inject({ method: "POST", url: "/sync" });
    const { rows } = await ctx.db.query(`SELECT amount_kop, created_at FROM orders WHERE id = $1`, [o.id]);
    expect(Number(rows[0].amount_kop)).toBe(250000);
    expect(rows[0].created_at.toISOString()).toBe("2026-02-10T21:30:00.000Z");
  });
});
