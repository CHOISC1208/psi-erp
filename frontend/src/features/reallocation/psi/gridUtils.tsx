import type { Column } from "react-data-grid";

import type { MetricDefinition, PsiRow } from "./types";
import { PSI_GRID_CONFIG } from "./gridLayoutConfig";
import { buildColumnGroups, formatMetricValue, getMetricValue, makeColumnKey, safeNumber } from "./utils";

export interface MatrixColumnMeta {
  id: string;
  warehouse: string;
  channel: string;
  shortLabel: string;
  fullLabel: string;
  tooltip: string;
}

export interface MatrixGroupMeta {
  id: string;
  shortLabel: string;
  fullLabel: string;
  tooltip: string;
  columns: MatrixColumnMeta[];
}

export interface MetricRowData {
  id: string;
  metricKey: MetricDefinition["key"];
  metricLabel: string;
  metricShortLabel?: string;
  metricTooltip?: string;
  total: string;
  totalValue: number;
  values: Record<string, number | null>;
  groupTotals: Record<string, number>;
}

const abbreviate = (value: string, dictionary: Record<string, string>): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return "-";
  }
  return dictionary[trimmed] ?? (trimmed.length <= 6 ? trimmed : trimmed.slice(0, 6));
};

const normalizeGroupOrder = (name: string, order: string[]): number => {
  const index = order.indexOf(name);
  return index === -1 ? Number.MAX_SAFE_INTEGER : index;
};

export const buildWarehouseFirstGroups = (rows: PsiRow[]): MatrixGroupMeta[] => {
  const groups = buildColumnGroups(rows);
  const sortedGroups = groups.sort((a, b) => {
    const orderA = normalizeGroupOrder(a.warehouse, PSI_GRID_CONFIG.groupOrder);
    const orderB = normalizeGroupOrder(b.warehouse, PSI_GRID_CONFIG.groupOrder);
    if (orderA !== orderB) {
      return orderA - orderB;
    }
    return a.warehouse.localeCompare(b.warehouse);
  });
  return sortedGroups.map((group) => ({
    id: `warehouse:${group.warehouse}`,
    shortLabel: abbreviate(group.warehouse, PSI_GRID_CONFIG.warehouseAbbreviations),
    fullLabel: group.warehouse,
    tooltip: group.warehouse,
    columns: group.channels
      .sort((a, b) => {
        const orderA = normalizeGroupOrder(a, PSI_GRID_CONFIG.channelOrder);
        const orderB = normalizeGroupOrder(b, PSI_GRID_CONFIG.channelOrder);
        if (orderA !== orderB) {
          return orderA - orderB;
        }
        return a.localeCompare(b);
      })
      .map<MatrixColumnMeta>((channel) => ({
        id: makeColumnKey(group.warehouse, channel),
        warehouse: group.warehouse,
        channel,
        shortLabel: abbreviate(channel, PSI_GRID_CONFIG.channelAbbreviations),
        fullLabel: channel,
        tooltip: `${group.warehouse} × ${channel}`,
      })),
  }));
};

export const buildChannelFirstGroups = (rows: PsiRow[]): MatrixGroupMeta[] => {
  const map = new Map<string, Set<string>>();
  rows.forEach((row) => {
    const channel = row.channel || "-";
    const warehouse = row.warehouse || "-";
    const set = map.get(channel) ?? new Set<string>();
    set.add(warehouse);
    map.set(channel, set);
  });
  return Array.from(map.entries())
    .sort((a, b) => {
      const orderA = normalizeGroupOrder(a[0], PSI_GRID_CONFIG.channelOrder);
      const orderB = normalizeGroupOrder(b[0], PSI_GRID_CONFIG.channelOrder);
      if (orderA !== orderB) {
        return orderA - orderB;
      }
      return a[0].localeCompare(b[0]);
    })
    .map<MatrixGroupMeta>(([channel, warehouses]) => ({
      id: `channel:${channel}`,
      shortLabel: abbreviate(channel, PSI_GRID_CONFIG.channelAbbreviations),
      fullLabel: channel,
      tooltip: channel,
      columns: Array.from(warehouses)
        .sort((a, b) => {
          const orderA = normalizeGroupOrder(a, PSI_GRID_CONFIG.groupOrder);
          const orderB = normalizeGroupOrder(b, PSI_GRID_CONFIG.groupOrder);
          if (orderA !== orderB) {
            return orderA - orderB;
          }
          return a.localeCompare(b);
        })
        .map<MatrixColumnMeta>((warehouse) => ({
          id: makeColumnKey(warehouse, channel),
          warehouse,
          channel,
          shortLabel: abbreviate(warehouse, PSI_GRID_CONFIG.warehouseAbbreviations),
          fullLabel: warehouse,
          tooltip: `${warehouse} × ${channel}`,
        })),
    }));
};

export const buildMetricRows = (
  rows: PsiRow[],
  metrics: MetricDefinition[],
  columnIds: string[],
  columnGroups: MatrixGroupMeta[],
) => {
  const rowMap = new Map<string, PsiRow>();
  rows.forEach((row) => {
    rowMap.set(makeColumnKey(row.warehouse, row.channel), row);
  });

  return metrics.map<MetricRowData>((metric) => {
    const values: Record<string, number | null> = {};
    let metricTotal = 0;
    const groupTotals: Record<string, number> = {};

    columnIds.forEach((columnId) => {
      const value = getMetricValue(rowMap.get(columnId), metric.key);
      values[columnId] = value;
      metricTotal += safeNumber(value);
    });

    columnGroups.forEach((group) => {
      let sum = 0;
      group.columns.forEach((column) => {
        sum += safeNumber(values[column.id]);
      });
      groupTotals[group.id] = sum;
    });

    return {
      id: metric.key,
      metricKey: metric.key,
      metricLabel: metric.label,
      metricShortLabel: metric.shortLabel,
      metricTooltip: metric.description,
      totalValue: metricTotal,
      total: formatMetricValue(metricTotal),
      values,
      groupTotals,
    } satisfies MetricRowData;
  });
};

export const buildColumnIdList = (groups: MatrixGroupMeta[]): string[] =>
  groups.flatMap((group) => group.columns.map((column) => column.id));

export const makeValueColumn = (
  meta: MatrixColumnMeta,
  options: {
    compactMode: boolean;
    hidden?: boolean;
    className?: Column<MetricRowData>["className"];
    headerClass?: string;
    groupCollapsed?: boolean;
  },
): Column<MetricRowData> => ({
  key: meta.id,
  name: options.compactMode ? meta.shortLabel : meta.fullLabel,
  width: PSI_GRID_CONFIG.widths.value,
  headerCellClass: options.headerClass,
  className: options.className ?? "psi-matrix-value-cell",
  frozen: false,
  renderCell: ({ row }) => {
    const rawValue = row.values[meta.id];
    const formatted = formatMetricValue(rawValue);
    const numeric = rawValue ?? 0;
    const trendClass = numeric === 0 ? "value-neutral" : numeric > 0 ? "value-positive" : "value-negative";
    return (
      <span className={`psi-matrix-value ${trendClass}`} title={`${meta.tooltip} : ${formatted}`}>
        {formatted}
      </span>
    );
  },
  ...(options.hidden ? { width: 0, className: "psi-matrix-column-hidden" } : null),
});

export const makeCollapsedGroupColumn = (
  group: MatrixGroupMeta,
  options: {
    compactMode: boolean;
    renderValue?: (params: { row: MetricRowData; formatted: string }) => React.ReactNode;
  },
): Column<MetricRowData> => ({
  key: `${group.id}::collapsed`,
  name: options.compactMode ? group.shortLabel : group.fullLabel,
  width: PSI_GRID_CONFIG.widths.value,
  headerCellClass: "psi-matrix-header--collapsed",
  className: "psi-matrix-cell--collapsed",
  renderCell: ({ row }) => {
    const value = row.groupTotals[group.id] ?? 0;
    const formatted = formatMetricValue(value);
    const trendClass = value === 0 ? "value-neutral" : value > 0 ? "value-positive" : "value-negative";
    if (options.renderValue) {
      return options.renderValue({ row, formatted });
    }
    return <span className={`psi-matrix-value ${trendClass}`}>{formatted}</span>;
  },
});

export const buildGroupTotals = (
  metrics: MetricDefinition[],
  columnGroups: MatrixGroupMeta[],
  metricRows: MetricRowData[],
) => {
  const totals = new Map<string, Map<string, number>>();
  columnGroups.forEach((group) => {
    const metricTotals = new Map<string, number>();
    metrics.forEach((metric) => {
      let sum = 0;
      group.columns.forEach((column) => {
        const value = metricRows.find((row) => row.metricKey === metric.key)?.values[column.id];
        sum += safeNumber(value);
      });
      metricTotals.set(metric.key, sum);
    });
    totals.set(group.id, metricTotals);
  });
  return totals;
};
