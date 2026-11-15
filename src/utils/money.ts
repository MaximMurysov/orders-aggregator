/**
 * Деньги внутри сервиса — целые копейки. Рубли — только на входе (внешний API) и в ответах.
 */

const DECIMAL = /^\+?(\d+(?:\.\d*)?|\.\d+)(?:e([+-]?\d+))?$/i;

/** Сумма из внешнего API: число или строка с числом ("250.10"). */
export function parseRub(raw: unknown): number {
  const value = typeof raw === "string" && DECIMAL.test(raw.trim()) ? Number(raw.trim()) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`invalid amount: ${JSON.stringify(raw)}`);
  }
  return value;
}

/** Рубли → копейки. Доли копейки отбрасываются: деньги клиенту не досчитываем. */
export function toKop(rub: number | string): number {
  parseRub(rub);
  const text = typeof rub === "string" ? rub.trim() : String(rub);
  const match = DECIMAL.exec(text)!;
  const [whole, fraction = ""] = match[1].split(".");
  // Shift decimal digits rather than multiplying a binary float by 100.
  const digits = (whole + fraction).replace(/^0+/, "");
  if (!digits) return 0;
  const shift = 2 + Number(match[2] ?? 0) - fraction.length;
  if (digits.length + shift <= 0) return 0;
  if (digits.length + shift > 16) throw new Error("amount exceeds safe integer kopecks");
  const integer = shift < 0 ? digits.slice(0, digits.length + shift) : digits + "0".repeat(shift);
  const kop = Number(integer);
  if (!Number.isSafeInteger(kop)) throw new Error("amount exceeds safe integer kopecks");
  return kop;
}

/** Копейки → рубли для ответа API. */
export function fromKop(kop: number): number {
  return kop / 100;
}
