import { useMemo } from "react";

import type { MetricDefinition, PsiRow } from "../types";
import {
  buildColumnGroups,
  formatMetricValue,
  getMetricValue,
  makeColumnKey,
  safeNumber,
} from "../utils";

interface CrossTableViewProps {
  rows: PsiRow[];
  metrics: MetricDefinition[];
  orientation?: "warehouse-first" | "channel-first";
}

interface HeaderColumn {
  key: string;
  warehouse: string;
  channel: string;
  label: string;
  className: string;
}

interface HeaderGroup {
  label: string;
  className: string;
  columns: HeaderColumn[];
}

const getValueClassName = (value: number | null) => {
  if (value === null || value === 0) {
    return "value-neutral";
  }
  if (value > 0) {
    return "value-positive";
  }
  return "value-negative";
};

const buildHeaderGroups = (rows: PsiRow[], orientation: Required<CrossTableViewProps>["orientation"]): HeaderGroup[] => {
  if (orientation === "channel-first") {
    const map = new Map<string, Set<string>>();
    rows.forEach((row) => {
      const channel = row.channel || "-";
      const warehouse = row.warehouse || "-";
      const set = map.get(channel) ?? new Set<string>();
      set.add(warehouse);
      map.set(channel, set);
    });
    return Array.from(map.entries())
      .map(([channel, warehouses]) => ({
        label: channel,
        className: "channel-header",
        columns: Array.from(warehouses)
          .sort((a, b) => a.localeCompare(b))
          .map<HeaderColumn>((warehouse) => ({
            key: makeColumnKey(warehouse, channel),
            warehouse,
            channel,
            label: warehouse,
            className: "warehouse-header",
          })),
      }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  return buildColumnGroups(rows).map<HeaderGroup>((group) => ({
    label: group.warehouse,
    className: "warehouse-header",
    columns: group.channels.map<HeaderColumn>((channel) => ({
      key: makeColumnKey(group.warehouse, channel),
      warehouse: group.warehouse,
      channel,
      label: channel,
      className: "channel-header",
    })),
  }));
};

export default function CrossTableView({ rows, metrics, orientation = "warehouse-first" }: CrossTableViewProps) {
  const headerGroups = useMemo(() => buildHeaderGroups(rows, orientation), [rows, orientation]);
  const headerColumns = useMemo(
    () => headerGroups.flatMap((group) => group.columns),
    [headerGroups],
  );
  const rowMap = useMemo(() => {
    const map = new Map<string, PsiRow>();
    rows.forEach((row) => {
      map.set(makeColumnKey(row.warehouse, row.channel), row);
    });
    return map;
  }, [rows]);

  if (headerColumns.length === 0) {
    return <p className="psi-matrix-empty">No rows match the current filters.</p>;
  }

  const totalsByMetric = useMemo(() => {
    const totals = new Map<string, number>();
    metrics.forEach((metric) => {
      const total = headerColumns.reduce((sum, column) => {
        const value = getMetricValue(rowMap.get(column.key), metric.key);
        return sum + safeNumber(value);
      }, 0);
      totals.set(metric.key, total);
    });
    return totals;
  }, [headerColumns, metrics, rowMap]);

  return (
    <div className="psi-matrix-scroll">
      <table className="psi-matrix-table">
        <thead>
          <tr>
            <th rowSpan={2} className="metric-column">
              Metric
            </th>
            {headerGroups.map((group) => (
              <th key={group.label} colSpan={group.columns.length} className={group.className}>
                {group.label}
              </th>
            ))}
            <th rowSpan={2} className="total-column">
              Total
            </th>
          </tr>
          <tr>
            {headerGroups.flatMap((group) =>
              group.columns.map((column) => (
                <th key={column.key} className={column.className}>
                  {column.label}
                </th>
              )),
            )}
          </tr>
        </thead>
        <tbody>
          {metrics.map((metric) => (
            <tr key={metric.key}>
              <th scope="row" className="metric-label">
                {metric.label}
              </th>
              {headerColumns.map((column) => {
                const value = getMetricValue(rowMap.get(column.key), metric.key);
                return (
                  <td key={column.key} className={getValueClassName(value)}>
                    {formatMetricValue(value)}
                  </td>
                );
              })}
              <td className="total-cell">{formatMetricValue(totalsByMetric.get(metric.key) ?? 0)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
