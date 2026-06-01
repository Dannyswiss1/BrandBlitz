import Decimal from "decimal.js";

export interface FormatUsdcOptions {
  precision?: 2 | 7;
}

export function formatUsdc(
  amount: string | number,
  { precision = 2 }: FormatUsdcOptions = {}
): string {
  const d = new Decimal(String(amount));
  const isNegative = d.isNegative();
  const formatted = d.abs().toFixed(precision);
  const [whole, frac = ""] = formatted.split(".");
  const intPart = Number(whole).toLocaleString("en-US");
  const result = `${intPart}.${frac} USDC`;
  return isNegative ? `-${result}` : result;
}

export function formatScore(score: number): string {
  return score.toLocaleString();
}
