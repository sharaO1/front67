import { describe, expect, it } from "vitest";
import { getBranchStockStatus } from "./inventoryStock";

describe("getBranchStockStatus", () => {
  it("marks zero or negative quantities out of stock", () => {
    expect(getBranchStockStatus(0, 5)).toBe("out-of-stock");
    expect(getBranchStockStatus(-1, 5)).toBe("out-of-stock");
  });

  it("marks positive quantities at or below the minimum as low stock", () => {
    expect(getBranchStockStatus(5, 5)).toBe("low-stock");
    expect(getBranchStockStatus(4, 5)).toBe("low-stock");
  });

  it("does not flag stock above the minimum or without a configured minimum", () => {
    expect(getBranchStockStatus(6, 5)).toBeNull();
    expect(getBranchStockStatus(1, 0)).toBeNull();
  });
});
