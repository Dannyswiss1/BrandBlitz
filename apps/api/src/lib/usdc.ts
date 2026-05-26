export const STROOPS_PER_USDC = 10_000_000n;

export function usdcToStroops(amount: string): string {
  const match = amount.match(/^(\d+)(?:\.(\d{1,7})?)?$/);
  if (!match) {
    throw new Error("USDC amount must be a non-negative decimal with up to 7 places");
  }

  const whole = BigInt(match[1]);
  const fractional = (match[2] ?? "").padEnd(7, "0");
  return (whole * STROOPS_PER_USDC + BigInt(fractional)).toString();
}

export function stroopsToUsdc(stroops: string | number | bigint): string {
  const value = BigInt(stroops);
  const whole = value / STROOPS_PER_USDC;
  const fractional = value % STROOPS_PER_USDC;
  return `${whole}.${fractional.toString().padStart(7, "0")}`;
}

export function calculatePayoutShareStroops(
  userScore: number,
  totalPointsAllUsers: number,
  poolAmountStroops: string | number | bigint
): bigint {
  if (totalPointsAllUsers === 0) return 0n;
  return (BigInt(poolAmountStroops) * BigInt(userScore)) / BigInt(totalPointsAllUsers);
}
