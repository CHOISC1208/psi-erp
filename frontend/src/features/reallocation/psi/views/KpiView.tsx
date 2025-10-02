import { useMemo } from "react";

import type { PsiRow } from "../types";
import {
  KPI_CARD_METRICS,
  buildColumnGroups,
  columnKeysFromGroups,
  formatMetricValue,
  makeColumnKey,
  safeNumber,
  sumByMetric,
} from "../utils";

const MINI_TABLE_METRICS = ["stockFinal", "gap", "gapAfter"] as const;

type MiniTableMetric = (typeof MINI_TABLE_METRICS)[number];

export default function KpiView({ rows }: { rows: PsiRow[] }) {
  const totals = useMemo(() => {
    const record = new Map<string, number>();
    KPI_CARD_METRICS.forEach((metric) => {
      record.set(metric.key, sumByMetric(rows, metric.key));
    });
    return record;
  }, [rows]);

  const columnGroups = useMemo(() => buildColumnGroups(rows), [rows]);
  const columnKeys = useMemo(() => columnKeysFromGroups(columnGroups), [columnGroups]);
  const rowMap = useMemo(() => {
    const map = new Map<string, PsiRow>();
    rows.forEach((row) => {
      map.set(makeColumnKey(row.warehouse, row.channel), row);
    });
    return map;
  }, [rows]);

  if (rows.length === 0) {
    return <p className="psi-matrix-empty">No rows match the current filters.</p>;
  }

  return (
    <div className="psi-kpi-view">
      <div className="psi-kpi-grid">
        {KPI_CARD_METRICS.map((metric) => {
          const total = totals.get(metric.key) ?? 0;
          return (
            <div key={metric.key} className={`psi-kpi-card ${metric.emphasize ? "emphasize" : ""}`}>
              <span className="psi-kpi-label">{metric.label}</span>
              <span className="psi-kpi-value">{formatMetricValue(total)}</span>
            </div>
          );
        })}
      </div>
      <div className="psi-kpi-table-wrapper">
        <table className="psi-kpi-mini-table">
          <thead>
            <tr>
              <th>Warehouse</th>
              <th>Channel</th>
              <th>Final</th>
              <th>Gap</th>
              <th>Gap After</th>
            </tr>
          </thead>
          <tbody>
            {columnKeys.map((column) => {
              const row = rowMap.get(column.key);
              const stockStartValue = safeNumber(row?.stockStart);
              const stdStockValue = safeNumber(row?.stdStock);
              const moveValue = safeNumber(row?.move);
              const gapValue = row?.gap ?? stockStartValue - stdStockValue;
              const gapAfterValue =
                row?.gapAfter ?? stockStartValue + moveValue - stdStockValue;
              const values: Record<MiniTableMetric, number> = {
                stockFinal: safeNumber(row?.stockFinal),
                gap: gapValue,
                gapAfter: gapAfterValue,
              };
              return (
                <tr key={column.key}>
                  <td>{column.warehouse}</td>
                  <td>{column.channel}</td>
                  {MINI_TABLE_METRICS.map((metric) => {
                    const value = values[metric];
                    const className = value > 0 ? "value-positive" : value < 0 ? "value-negative" : "value-neutral";
                    return (
                      <td key={metric} className={className}>
                        {formatMetricValue(value)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
