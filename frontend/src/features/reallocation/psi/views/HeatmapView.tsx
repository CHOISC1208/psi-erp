import { useMemo, useState } from "react";

import type { MetricDefinition, MetricKey, PsiRow } from "../types";
import {
  DEFAULT_HEATMAP_METRICS,
  buildColumnGroups,
  columnKeysFromGroups,
  formatMetricValue,
  getMetricValue,
  makeColumnKey,
  safeNumber,
} from "../utils";

interface HeatmapViewProps {
  rows: PsiRow[];
  metrics: MetricDefinition[];
  initialSelection?: MetricKey[];
}

const buildInitialSelection = (metrics: MetricDefinition[], initialSelection?: MetricKey[]) => {
  if (initialSelection?.length) {
    const allowed = new Set(initialSelection);
    const normalized = metrics
      .map((metric) => metric.key)
      .filter((metricKey) => allowed.has(metricKey));
    if (normalized.length > 0) {
      return normalized;
    }
  }

  const defaults = metrics.filter((metric) => DEFAULT_HEATMAP_METRICS.includes(metric.key));
  if (defaults.length > 0) {
    return defaults.map((metric) => metric.key);
  }
  return metrics.length > 0 ? [metrics[0].key] : [];
};

const createHeatmapStyle = (value: number | null, maxAbs: number) => {
  if (value === null || maxAbs === 0) {
    return {};
  }
  const intensity = Math.min(Math.abs(value) / maxAbs, 1);
  const alpha = 0.2 + intensity * 0.5;
  const backgroundColor = value >= 0 ? `rgba(34, 197, 94, ${alpha})` : `rgba(239, 68, 68, ${alpha})`;
  const textColor = intensity > 0.6 ? "var(--surface-body)" : undefined;
  return { backgroundColor, color: textColor };
};

export default function HeatmapView({ rows, metrics, initialSelection }: HeatmapViewProps) {
  const [selectedMetricSet, setSelectedMetricSet] = useState(
    () => new Set<MetricKey>(buildInitialSelection(metrics, initialSelection)),
  );
  const selectedMetrics = useMemo(
    () => metrics.filter((metric) => selectedMetricSet.has(metric.key)).map((metric) => metric.key),
    [metrics, selectedMetricSet],
  );
  const columnGroups = useMemo(() => buildColumnGroups(rows), [rows]);
  const columnKeys = useMemo(() => columnKeysFromGroups(columnGroups), [columnGroups]);
  const rowMap = useMemo(() => {
    const map = new Map<string, PsiRow>();
    rows.forEach((row) => {
      map.set(makeColumnKey(row.warehouse, row.channel), row);
    });
    return map;
  }, [rows]);

  const heatmapMax = useMemo(() => {
    let max = 0;
    selectedMetrics.forEach((metric) => {
      columnKeys.forEach((column) => {
        const value = getMetricValue(rowMap.get(column.key), metric);
        if (value !== null) {
          max = Math.max(max, Math.abs(value));
        }
      });
    });
    return max;
  }, [selectedMetrics, columnKeys, rowMap]);

  const handleToggleMetric = (metricKey: MetricKey) => {
    setSelectedMetricSet((prev) => {
      const next = new Set(prev);
      if (next.has(metricKey)) {
        next.delete(metricKey);
      } else {
        next.add(metricKey);
      }
      return next;
    });
  };

  const handleSelectAll = () => {
    setSelectedMetricSet(new Set(metrics.map((metric) => metric.key)));
  };

  const handleReset = () => {
    setSelectedMetricSet(new Set(buildInitialSelection(metrics, initialSelection)));
  };

  if (columnKeys.length === 0) {
    return <p className="psi-matrix-empty">No rows match the current filters.</p>;
  }

  return (
    <div className="psi-heatmap">
      <div className="psi-heatmap-controls">
        <div className="psi-heatmap-buttons">
          <button type="button" onClick={handleSelectAll} disabled={selectedMetrics.length === metrics.length}>
            All
          </button>
          <button type="button" onClick={handleReset}>
            Reset
          </button>
        </div>
        <div className="psi-heatmap-checkboxes">
          {metrics.map((metric) => (
            <label key={metric.key} className="psi-heatmap-checkbox">
              <input
                type="checkbox"
                checked={selectedMetricSet.has(metric.key)}
                onChange={() => handleToggleMetric(metric.key)}
              />
              <span>{metric.label}</span>
            </label>
          ))}
        </div>
      </div>
      {selectedMetrics.length === 0 ? (
        <p className="psi-matrix-empty">Select at least one metric to display the heatmap.</p>
      ) : (
        <div className="psi-matrix-scroll">
          <table className="psi-matrix-table psi-heatmap-table">
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
                <th rowSpan={2} className="total-column">
                  Total
                </th>
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
              {selectedMetrics.map((metricKey) => {
                const metric = metrics.find((item) => item.key === metricKey);
                if (!metric) {
                  return null;
                }
                return (
                  <tr key={metric.key}>
                    <th scope="row" className="metric-label">
                      {metric.label}
                    </th>
                    {columnKeys.map((column) => {
                      const value = getMetricValue(rowMap.get(column.key), metric.key);
                      return (
                        <td
                          key={column.key}
                          className="matrix-value-cell"
                          style={createHeatmapStyle(value, heatmapMax)}
                        >
                          {formatMetricValue(value)}
                        </td>
                      );
                    })}
                    <td className="total-cell">
                      {formatMetricValue(
                        columnKeys.reduce((sum, column) => {
                          const value = getMetricValue(rowMap.get(column.key), metric.key);
                          return sum + safeNumber(value);
                        }, 0),
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
