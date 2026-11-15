-- Historical orders did not store payments. NULL means unknown until replay/sync;
-- do not invent a payment or change the source's updated_at during migration.
ALTER TABLE orders ADD COLUMN amount_paid_kop BIGINT;

ALTER TABLE orders ADD CONSTRAINT orders_payment_range CHECK (
  amount_paid_kop IS NULL OR (
    amount_paid_kop >= 0 AND amount_paid_kop <= amount_kop
    AND amount_kop <= 9007199254740991
  )
);
