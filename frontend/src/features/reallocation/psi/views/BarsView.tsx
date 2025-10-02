import { useMemo } from "react";

import type { PsiRow } from "../types";
import { formatMetricValue, makeColumnKey, safeNumber } from "../utils";

interface BarsViewProps {
  rows: PsiRow[];
}

const BAR_METRICS = [
  { key: "stockStart", label: "Start", color: "#64748b" },
  { key: "inbound", label: "Inbound", color: "#22c55e" },
  { key: "outbound", label: "Outbound", color: "#f97316" },
  { key: "stockFinal", label: "Final", color: "#3b82f6" },
] as const;

type BarMetricKey = (typeof BAR_METRICS)[number]["key"];

type ChartDatum = {
  key: string;
  label: string;
  values: Record<BarMetricKey, number>;
};

const buildTooltip = (values: Record<BarMetricKey, number>) =>
  BAR_METRICS.map((metric) => `${metric.label}: ${formatMetricValue(values[metric.key])}`).join("\n");

export default function BarsView({ rows }: BarsViewProps) {
  const data = useMemo<ChartDatum[]>(() => {
    const map = new Map<string, ChartDatum>();
    rows.forEach((row) => {
      const key = makeColumnKey(row.warehouse, row.channel);
      const values = map.get(key)?.values ?? {
        stockStart: 0,
        inbound: 0,
        outbound: 0,
        stockFinal: 0,
      };
      values.stockStart += safeNumber(row.stockStart);
      values.inbound += safeNumber(row.inbound);
      values.outbound += safeNumber(row.outbound);
      values.stockFinal += safeNumber(row.stockFinal);
      map.set(key, {
        key,
        label: `${row.warehouse}｜${row.channel}`,
        values,
      });
    });
    return Array.from(map.values()).sort((a, b) => a.label.localeCompare(b.label));
  }, [rows]);

  if (data.length === 0) {
    return <p className="psi-matrix-empty">No rows match the current filters.</p>;
  }

  return (
    <div className="psi-bars-chart">
      <div className="psi-bars-grid">
        {data.map((item) => {
          const total = BAR_METRICS.reduce(
            (sum, metric) => sum + Math.abs(item.values[metric.key]),
            0,
          );
          const tooltip = buildTooltip(item.values);
          return (
            <div key={item.key} className="psi-bar">
              <div className="psi-bar-stack" title={tooltip} aria-label={`Stacked metrics for ${item.label}`}>
                {BAR_METRICS.map((metric) => {
                  const value = Math.abs(item.values[metric.key]);
                  return (
                    <div
                      key={metric.key}
                      className="psi-bar-segment"
                      style={{
                        backgroundColor: metric.color,
                        flexGrow: value,
                        minHeight: value > 0 ? 6 : 0,
                      }}
                    >
                      {value > 0 && (
                        <span className="psi-bar-segment-label">
                          {formatMetricValue(item.values[metric.key])}
                        </span>
                      )}
                    </div>
                  );
                })}
                {total === 0 && <div className="psi-bar-empty">0</div>}
              </div>
              <div className="psi-bar-caption">
                <span className="psi-bar-label" title={item.label}>
                  {item.label}
                </span>
                <span className="psi-bar-final">{formatMetricValue(item.values.stockFinal)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
