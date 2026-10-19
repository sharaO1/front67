export type BranchStockStatus = "low-stock" | "out-of-stock";

export function getBranchStockStatus(
  quantity: number,
  minimum: number,
): BranchStockStatus | null {
  if (quantity <= 0) return "out-of-stock";
  if (minimum > 0 && quantity <= minimum) return "low-stock";
  return null;
}
