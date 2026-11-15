import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { migrate } from "../src/db.js";
import { setupTestApp } from "./helpers.js";

const ctx = setupTestApp();

describe("payment migration", () => {
  it("preserves historical money and versions without inventing a payment", async () => {
    const client = await ctx.db.connect();
    try {
      await client.query("BEGIN");
      await client.query("CREATE SCHEMA stage1_migration_test");
      await client.query("SET LOCAL search_path TO stage1_migration_test");
      await client.query(await readFile(new URL("../migrations/001_init.sql", import.meta.url), "utf8"));
      await client.query(`INSERT INTO orders VALUES ('legacy', 'c_1', 113, 'paid', '2026-02-10T12:00:00Z', '2026-02-10T12:00:00Z')`);
      await client.query(await readFile(new URL("../migrations/002_order_payments.sql", import.meta.url), "utf8"));
      const { rows } = await client.query(`SELECT amount_kop, amount_paid_kop, updated_at FROM orders`);
      expect(rows).toEqual([{ amount_kop: "113", amount_paid_kop: null, updated_at: new Date("2026-02-10T12:00:00Z") }]);
      await client.query(`UPDATE orders SET amount_paid_kop = 101`);
      await client.query("SAVEPOINT invalid_payment");
      await expect(client.query(`UPDATE orders SET amount_paid_kop = 114`)).rejects.toMatchObject({ code: "23514" });
      await client.query("ROLLBACK TO SAVEPOINT invalid_payment");
      await expect(client.query(`UPDATE orders SET amount_paid_kop = -1`)).rejects.toMatchObject({ code: "23514" });
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });

  it("does not apply migrations twice", async () => {
    expect(await migrate(ctx.db)).toEqual([]);
  });
});
