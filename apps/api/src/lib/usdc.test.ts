import { describe, expect, it } from "vitest";
import { calculatePayoutShareStroops, stroopsToUsdc, usdcToStroops } from "./usdc";

describe("USDC stroop helpers", () => {
  it("converts USDC strings to integer stroops", () => {
    expect(usdcToStroops("12.3456789")).toBe("123456789");
    expect(usdcToStroops("1")).toBe("10000000");
  });

  it("formats stroops as 7-decimal USDC", () => {
    expect(stroopsToUsdc(123456789n)).toBe("12.3456789");
    expect(stroopsToUsdc("1")).toBe("0.0000001");
  });

  it("calculates payout shares using integer math", () => {
    expect(calculatePayoutShareStroops(1, 3, 100000000n)).toBe(33333333n);
  });
});
