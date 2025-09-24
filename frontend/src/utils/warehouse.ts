export const NULL_WAREHOUSE_KEY = "__WAREHOUSE_NULL__";

export const makeWarehouseKey = (name: string | null | undefined): string => {
  if (typeof name !== "string") {
    return NULL_WAREHOUSE_KEY;
  }
  const trimmed = name.trim();
  if (!trimmed) {
    return NULL_WAREHOUSE_KEY;
  }
  return name;
};

export const formatWarehouseName = (name: string | null | undefined): string => {
  if (typeof name !== "string") {
    return "未設定倉庫";
  }
  const trimmed = name.trim();
  return trimmed || "未設定倉庫";
};
