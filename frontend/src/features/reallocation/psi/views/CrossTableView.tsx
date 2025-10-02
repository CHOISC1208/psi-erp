import { useMemo } from "react";

import type { MetricDefinition, PsiRow } from "../types";
import {
  buildColumnGroups,
  columnKeysFromGroups,
  formatMetricValue,
  getMetricValue,
  makeColumnKey,
} from "../utils";

interface CrossTableViewProps {
  rows: PsiRow[];
  metrics: MetricDefinition[];
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

export default function CrossTableView({ rows, metrics }: CrossTableViewProps) {
  const columnGroups = useMemo(() => buildColumnGroups(rows), [rows]);
  const columnKeys = useMemo(() => columnKeysFromGroups(columnGroups), [columnGroups]);
  const rowMap = useMemo(() => {
    const map = new Map<string, PsiRow>();
    rows.forEach((row) => {
      map.set(makeColumnKey(row.warehouse, row.channel), row);
    });
    return map;
  }, [rows]);

  if (columnKeys.length === 0) {
    return <p className="psi-matrix-empty">No rows match the current filters.</p>;
  }

  return (
    <div className="psi-matrix-scroll">
      <table className="psi-matrix-table">
        <thead>
          <tr>
            <th rowSpan={2} className="metric-column">
              Metric
            </th>
            {columnGroups.map((group) => (
              <th key={group.warehouse} colSpan={group.channels.length} className="warehouse-header">
                {group.warehouse}
              </th>
            ))}
          </tr>
          <tr>
            {columnGroups.flatMap((group) =>
              group.channels.map((channel) => (
                <th key={`${group.warehouse}|${channel}`} className="channel-header">
                  {channel}
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
              {columnKeys.map((column) => {
                const value = getMetricValue(rowMap.get(column.key), metric.key);
                return (
                  <td key={column.key} className={getValueClassName(value)}>
                    {formatMetricValue(value)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
