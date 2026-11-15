import { describe, expect, it } from "vitest";
import { fromKop, parseRub, toKop } from "../src/utils/money.js";

describe("parseRub", () => {
  it("принимает число и строку с числом", () => {
    expect(parseRub(2500)).toBe(2500);
    expect(parseRub("2500.00")).toBe(2500);
    expect(parseRub(" 99 ")).toBe(99);
  });

  it("отклоняет мусор и отрицательные суммы", () => {
    expect(() => parseRub("abc")).toThrow();
    expect(() => parseRub(null)).toThrow();
    expect(() => parseRub(-1)).toThrow();
  });
});

describe("toKop / fromKop", () => {
  it.each([
    [0.29, 29], [1.13, 113], [19.99, 1999], [1.005, 100],
    [10.999, 1099], [1e-7, 0], [1e3, 100000],
    ["0.29", 29], ["1.13", 113], [".29", 29], ["2.9e-1", 29],
    ["000.29", 29], ["90071992547409.91", Number.MAX_SAFE_INTEGER],
  ])("converts %s exactly with fractional kopecks truncated", (rub, kop) => {
    expect(toKop(rub)).toBe(kop);
  });

  it.each(["", " ", "0x10", "abc", -1, NaN, Infinity, "90071992547409.92", 1e20])(
    "rejects invalid or unsafe money %s", (rub) => {
      expect(() => toKop(rub)).toThrow();
    },
  );

  it("рубли в копейки", () => {
    expect(toKop(2500)).toBe(250000);
    expect(toKop(99)).toBe(9900);
  });

  it("отбрасывает доли копейки", () => {
    expect(toKop(10.999)).toBe(1099);
  });

  it("копейки в рубли", () => {
    expect(fromKop(250000)).toBe(2500);
    expect(fromKop(1099)).toBe(10.99);
  });
});
