import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import DataGrid, { type Column, type ColumnGroupDescriptor } from "react-data-grid";

import type { MetricDefinition, MetricKey, PsiRow } from "../types";
import {
  buildColumnIdList,
  buildMetricRows,
  buildWarehouseFirstGroups,
  makeCollapsedGroupColumn,
  type MatrixGroupMeta,
  type MetricRowData,
} from "../gridUtils";
import { PSI_GRID_CONFIG, type RowDensityMode } from "../gridLayoutConfig";
import { DEFAULT_HEATMAP_METRICS, formatMetricValue } from "../utils";
import MatrixColumnVisibilityPanel from "../components/MatrixColumnVisibilityPanel";

interface HeatmapViewProps {
  rows: PsiRow[];
  metrics: MetricDefinition[];
  compactMode: boolean;
  rowDensity: RowDensityMode;
}

const buildInitialSelection = (metrics: MetricDefinition[]) => {
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
  const color = intensity > 0.6 ? "var(--surface-body)" : undefined;
  return { backgroundColor, color };
};

const buildHeatmapColumn = (
  meta: MatrixGroupMeta["columns"][number],
  options: { compactMode: boolean; maxAbs: number },
): Column<MetricRowData> => ({
  key: meta.id,
  name: options.compactMode ? meta.shortLabel : meta.fullLabel,
  width: PSI_GRID_CONFIG.widths.value,
  className: options.compactMode
    ? "psi-matrix-value-cell psi-matrix-value-cell--compact psi-matrix-value-cell--heatmap"
    : "psi-matrix-value-cell psi-matrix-value-cell--heatmap",
  headerCellClass: "psi-matrix-header--heatmap",
  renderCell: ({ row }) => {
    const value = row.values[meta.id];
    const formatted = formatMetricValue(value);
    const style = createHeatmapStyle(value, options.maxAbs);
    return (
      <span className="psi-matrix-heatmap-value" style={style} title={`${meta.tooltip} : ${formatted}`}>
        {formatted}
      </span>
    );
  },
});

export default function HeatmapView({ rows, metrics, compactMode, rowDensity }: HeatmapViewProps) {
  const [selectedMetrics, setSelectedMetrics] = useState<MetricKey[]>(() => buildInitialSelection(metrics));
  const columnGroups = useMemo(() => buildWarehouseFirstGroups(rows), [rows]);
  const columnIds = useMemo(() => buildColumnIdList(columnGroups), [columnGroups]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => new Set(columnIds));

  useEffect(() => {
    setVisibleColumns((previous) => {
      const next = new Set(previous);
      columnIds.forEach((id) => next.add(id));
      Array.from(next).forEach((id) => {
        if (!columnIds.includes(id)) {
          next.delete(id);
        }
      });
      return next;
    });
  }, [columnIds]);

  useEffect(() => {
    setCollapsedGroups((previous) => {
      const next = new Set<string>();
      columnGroups.forEach((group) => {
        if (previous.has(group.id)) {
          next.add(group.id);
        }
      });
      return next;
    });
  }, [columnGroups]);

  const metricRows = useMemo(
    () => buildMetricRows(rows, metrics, columnIds, columnGroups),
    [rows, metrics, columnIds, columnGroups],
  );

  const activeRows = useMemo(
    () => metricRows.filter((row) => selectedMetrics.includes(row.metricKey)),
    [metricRows, selectedMetrics],
  );

  const heatmapMax = useMemo(() => {
    let max = 0;
    activeRows.forEach((row) => {
      columnIds.forEach((columnId) => {
        const value = row.values[columnId];
        if (typeof value === "number" && Number.isFinite(value)) {
          const abs = Math.abs(value);
          if (abs > max) {
            max = abs;
          }
        }
      });
    });
    return max;
  }, [activeRows, columnIds]);

  const metricColumn: Column<MetricRowData> = useMemo(
    () => ({
      key: "metric",
      name: "Metric",
      width: PSI_GRID_CONFIG.widths.metric,
      frozen: true,
      headerCellClass: "psi-matrix-header psi-matrix-header--metric",
      className: compactMode
        ? "psi-matrix-cell psi-matrix-cell--metric psi-matrix-cell--compact"
        : "psi-matrix-cell psi-matrix-cell--metric",
      renderCell: ({ row }) => {
        const label = compactMode && row.metricShortLabel ? row.metricShortLabel : row.metricLabel;
        return (
          <span className="psi-matrix-metric-label" title={row.metricTooltip ?? row.metricLabel}>
            {label}
          </span>
        );
      },
    }),
    [compactMode],
  );

  const totalColumn: Column<MetricRowData> = useMemo(
    () => ({
      key: "total",
      name: "Total",
      width: PSI_GRID_CONFIG.widths.total,
      frozen: true,
      headerCellClass: "psi-matrix-header psi-matrix-header--total",
      className: "psi-matrix-cell psi-matrix-cell--total",
      renderCell: ({ row }) => {
        const formatted = formatMetricValue(row.totalValue);
        return <span className="psi-matrix-value psi-matrix-value--heatmap-total">{formatted}</span>;
      },
    }),
    [],
  );

  const heatmapColumns = useMemo(() => {
    const columns: Column<MetricRowData>[] = [];
    const groupDescriptors: ColumnGroupDescriptor[] = [];

    columnGroups.forEach((group) => {
      const groupColumnKeys: string[] = [];
      if (collapsedGroups.has(group.id)) {
        const collapsed = makeCollapsedGroupColumn(group, {
          compactMode,
          renderValue: ({ row, formatted }) => {
            const value = row.groupTotals[group.id] ?? 0;
            const style = createHeatmapStyle(value, heatmapMax);
            return (
              <span className="psi-matrix-heatmap-value" style={style}>
                {formatted}
              </span>
            );
          },
        });
        columns.push({ ...collapsed, className: "psi-matrix-value-cell psi-matrix-value-cell--heatmap" });
        groupColumnKeys.push(collapsed.key);
      } else {
        group.columns.forEach((meta) => {
          if (!visibleColumns.has(meta.id)) {
            return;
          }
          const column = buildHeatmapColumn(meta, { compactMode, maxAbs: heatmapMax });
          columns.push(column);
          groupColumnKeys.push(column.key);
        });
        if (groupColumnKeys.length === 0) {
          const placeholder = makeCollapsedGroupColumn(group, {
            compactMode,
            renderValue: () => <span className="psi-matrix-heatmap-value">—</span>,
          });
          const placeholderKey = `${placeholder.key}::placeholder`;
          columns.push({ ...placeholder, key: placeholderKey });
          groupColumnKeys.push(placeholderKey);
        }
      }

      if (groupColumnKeys.length > 0) {
        groupDescriptors.push({
          id: group.id,
          label: compactMode ? group.shortLabel : group.fullLabel,
          columnKeys: groupColumnKeys,
          collapsed: collapsedGroups.has(group.id),
          tooltip: group.tooltip,
        });
      }
    });

    return { columns, groupDescriptors } as const;
  }, [columnGroups, collapsedGroups, visibleColumns, compactMode, heatmapMax]);

  const allColumns = useMemo(
    () => [metricColumn, totalColumn, ...heatmapColumns.columns],
    [metricColumn, totalColumn, heatmapColumns.columns],
  );

  const handleToggleMetric = (metricKey: MetricKey) => {
    setSelectedMetrics((prev) => {
      if (prev.includes(metricKey)) {
        return prev.filter((item) => item !== metricKey);
      }
      return [...prev, metricKey];
    });
  };

  const handleSelectAll = () => {
    setSelectedMetrics(metrics.map((metric) => metric.key));
  };

  const handleReset = () => {
    setSelectedMetrics(buildInitialSelection(metrics));
  };

  const handleToggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((previous) => {
      const next = new Set(previous);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const handleToggleGroupVisibility = useCallback((groupId: string, visible: boolean) => {
    const group = columnGroups.find((item) => item.id === groupId);
    if (!group) {
      return;
    }
    setVisibleColumns((previous) => {
      const next = new Set(previous);
      group.columns.forEach((column) => {
        if (visible) {
          next.add(column.id);
        } else {
          next.delete(column.id);
        }
      });
      return next;
    });
  }, [columnGroups]);

  const handleToggleColumnVisibility = useCallback((columnId: string, visible: boolean) => {
    setVisibleColumns((previous) => {
      const next = new Set(previous);
      if (visible) {
        next.add(columnId);
      } else {
        next.delete(columnId);
      }
      return next;
    });
  }, []);

  if (allColumns.length <= 2) {
    return <p className="psi-matrix-empty">No rows match the current filters.</p>;
  }

  const gridClassName = [
    "psi-matrix-grid",
    "psi-matrix-grid--heatmap",
    compactMode ? "psi-matrix-grid--compact" : null,
    rowDensity === "fixed" ? "psi-matrix-grid--fixed" : "psi-matrix-grid--auto",
  ]
    .filter(Boolean)
    .join(" ");

  const fixedRowHeight = rowDensity === "fixed"
    ? compactMode
      ? PSI_GRID_CONFIG.compact.rowHeight
      : PSI_GRID_CONFIG.defaultRowHeight
    : undefined;

  const gridStyle: CSSProperties | undefined = fixedRowHeight
    ? ({ "--psi-matrix-row-height": `${fixedRowHeight}px` } as CSSProperties)
    : undefined;

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
                checked={selectedMetrics.includes(metric.key)}
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
        <>
          <MatrixColumnVisibilityPanel
            groups={columnGroups}
            collapsedGroups={collapsedGroups}
            visibleColumns={visibleColumns}
            onToggleGroupCollapse={handleToggleGroup}
            onToggleGroupVisibility={handleToggleGroupVisibility}
            onToggleColumnVisibility={handleToggleColumnVisibility}
          />
          <div className={gridClassName} style={gridStyle}>
            <DataGrid
              columns={allColumns}
              rows={activeRows}
              rowKeyGetter={(row) => row.id}
              className="psi-matrix-rdg"
              columnGroups={heatmapColumns.groupDescriptors}
              onToggleColumnGroup={handleToggleGroup}
              headerRowHeight={compactMode ? 36 : 44}
              groupHeaderRowHeight={compactMode ? 32 : 40}
              defaultColumnOptions={{ width: PSI_GRID_CONFIG.widths.value }}
            />
          </div>
        </>
      )}
    </div>
  );
}
