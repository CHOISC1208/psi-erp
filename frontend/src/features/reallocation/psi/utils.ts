import type {
  ColumnGroup,
  ColumnKey,
  MetricDefinition,
  MetricKey,
  PsiRow,
} from "./types";
import type { PSIMetricDefinition } from "../../../types";
import { orderMetrics } from "../../../utils/metrics";

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

const MASTER_METRIC_NAME_MAP: Partial<Record<string, MetricKey>> = {
  "stock_at_anchor": "stockStart",
  "stock start": "stockStart",
  "stock_start": "stockStart",
  inbound: "inbound",
  "inbound_qty": "inbound",
  "inbound qty": "inbound",
  outbound: "outbound",
  "outbound_qty": "outbound",
  "outbound qty": "outbound",
  "stock_closing": "stockClosing",
  "stock closing": "stockClosing",
  "stock_close": "stockClosing",
  move: "move",
  "stock_fin": "stockFinal",
  "stock final": "stockFinal",
  "stock_final": "stockFinal",
  stdstock: "stdStock",
  "std stock": "stdStock",
  "std_stock": "stdStock",
  gap: "gap",
  "gap_after": "gapAfter",
  "gap after": "gapAfter",
};

export const orderMetricsByDisplayOrder = (
  baseMetrics: MetricDefinition[],
  masterMetrics?: PSIMetricDefinition[],
): MetricDefinition[] => {
  if (!masterMetrics?.length) {
    return baseMetrics;
  }

  const definitionsByKey = new Map<MetricKey, MetricDefinition>();
  baseMetrics.forEach((definition) => {
    definitionsByKey.set(definition.key, definition);
  });

  const seen = new Set<MetricKey>();
  const ordered: MetricDefinition[] = [];

  const sortedMasters = orderMetrics(masterMetrics);

  for (const master of sortedMasters) {
    const normalizedName = master.name.trim().toLowerCase();
    const metricKey = MASTER_METRIC_NAME_MAP[normalizedName];
    if (!metricKey || seen.has(metricKey)) {
      continue;
    }
    const definition = definitionsByKey.get(metricKey);
    if (!definition) {
      continue;
    }
    ordered.push(definition);
    seen.add(metricKey);
  }

  baseMetrics.forEach((definition) => {
    if (!seen.has(definition.key)) {
      ordered.push(definition);
    }
  });

  return ordered;
};

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
      const stockFinal = safeNumber(row.stockFinal);
      const stdStock = safeNumber(row.stdStock);
      return stockFinal - stdStock;
    }
    case "gapAfter": {
      const gap = getMetricValue(row, "gap");
      const move = safeNumber(row.move);
      if (gap === null) {
        return null;
      }
      return gap + move;
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
