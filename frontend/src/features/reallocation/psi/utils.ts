import type { ColumnGroup, ColumnKey, MetricDefinition, MetricKey, PsiRow } from "./types";

export const METRIC_DEFINITIONS: MetricDefinition[] = [
  { key: "stockStart", label: "Stock @ Start", shortLabel: "Start" },
  { key: "inbound", label: "Inbound", shortLabel: "Inbound" },
  { key: "outbound", label: "Outbound", shortLabel: "Outbound" },
  { key: "stockClosing", label: "Stock Closing", shortLabel: "Closing" },
  { key: "move", label: "Move", shortLabel: "Move" },
  { key: "stockFinal", label: "Stock Final", shortLabel: "Final" },
  { key: "stdStock", label: "Std Stock", shortLabel: "Std" },
  { key: "gap", label: "Gap", shortLabel: "Gap" },
  { key: "gapAfter", label: "Gap After", shortLabel: "Gap After" },
];

export const KPI_CARD_METRICS: Array<{ key: MetricKey; label: string; emphasize?: boolean }> = [
  { key: "stockStart", label: "Start" },
  { key: "inbound", label: "Inbound" },
  { key: "outbound", label: "Outbound" },
  { key: "stockFinal", label: "Final" },
  { key: "gap", label: "Gap", emphasize: true },
  { key: "gapAfter", label: "Gap After", emphasize: true },
  { key: "stdStock", label: "Std Stock" },
  { key: "move", label: "Move" },
];

export const DEFAULT_HEATMAP_METRICS: MetricKey[] = ["gap", "gapAfter"];

export const makeColumnKey = (warehouse: string, channel: string) => `${warehouse}｜${channel}`;

export const buildColumnGroups = (rows: PsiRow[]): ColumnGroup[] => {
  const map = new Map<string, Set<string>>();
  rows.forEach((row) => {
    const warehouse = row.warehouse || "-";
    const channel = row.channel || "-";
    const set = map.get(warehouse) ?? new Set<string>();
    set.add(channel);
    map.set(warehouse, set);
  });
  return Array.from(map.entries())
    .map(([warehouse, channelSet]) => ({
      warehouse,
      channels: Array.from(channelSet).sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => a.warehouse.localeCompare(b.warehouse));
};

export const columnKeysFromGroups = (groups: ColumnGroup[]): ColumnKey[] =>
  groups.flatMap((group) =>
    group.channels.map((channel) => ({
      key: makeColumnKey(group.warehouse, channel),
      warehouse: group.warehouse,
      channel,
    })),
  );

export const safeNumber = (value: number | null | undefined): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

export const sumByMetric = (rows: PsiRow[], metric: MetricKey): number =>
  rows.reduce((total, row) => total + safeNumber(row[metric]), 0);

export const getMetricValue = (row: PsiRow | undefined, metric: MetricKey): number | null => {
  if (!row) {
    return null;
  }
  switch (metric) {
    case "gap": {
      const stdStock = safeNumber(row.stdStock);
      const stockClosing = safeNumber(row.stockClosing);
      return stdStock - stockClosing;
    }
    case "gapAfter": {
      const stdStock = safeNumber(row.stdStock);
      const stockClosing = safeNumber(row.stockClosing);
      const move = safeNumber(row.move);
      return stdStock - stockClosing + move;
    }
    default: {
      const value = row[metric];
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    }
  }
};

export const formatMetricValue = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  const fixed = value.toFixed(2);
  const [intPart, decimalPart = ""] = fixed.split(".");
  const sign = value < 0 ? "-" : "";
  const absInt = Math.abs(Number(intPart));
  const intWithSeparators = absInt.toLocaleString();
  const trimmedDecimal = decimalPart.replace(/0+$/, "");
  return `${sign}${intWithSeparators}${trimmedDecimal ? `.${trimmedDecimal}` : ""}`;
};
