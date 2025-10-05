import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import DataGrid, { type Column, type ColumnGroupDescriptor } from "react-data-grid";

import type { MetricDefinition, PsiRow } from "../types";
import {
  buildChannelFirstGroups,
  buildColumnIdList,
  buildMetricRows,
  buildWarehouseFirstGroups,
  makeCollapsedGroupColumn,
  makeValueColumn,
  type MatrixGroupMeta,
  type MetricRowData,
} from "../gridUtils";
import { PSI_GRID_CONFIG, type RowDensityMode } from "../gridLayoutConfig";
import MatrixColumnVisibilityPanel from "../components/MatrixColumnVisibilityPanel";
import { formatMetricValue } from "../utils";

interface CrossTableViewProps {
  rows: PsiRow[];
  metrics: MetricDefinition[];
  orientation?: "warehouse-first" | "channel-first";
  compactMode: boolean;
  rowDensity: RowDensityMode;
}

const METRIC_COLUMN_KEY = "metric";
const TOTAL_COLUMN_KEY = "total";

const buildGroupMeta = (
  rows: PsiRow[],
  orientation: Required<CrossTableViewProps>["orientation"],
): MatrixGroupMeta[] => {
  if (orientation === "channel-first") {
    return buildChannelFirstGroups(rows);
  }
  return buildWarehouseFirstGroups(rows);
};

const buildMetricColumn = (compactMode: boolean): Column<MetricRowData> => ({
  key: METRIC_COLUMN_KEY,
  name: "Metric",
  width: PSI_GRID_CONFIG.widths.metric,
  frozen: true,
  headerCellClass: "psi-matrix-header psi-matrix-header--metric",
  className: compactMode
    ? "psi-matrix-cell psi-matrix-cell--metric psi-matrix-cell--compact"
    : "psi-matrix-cell psi-matrix-cell--metric",
  renderCell: ({ row }) => {
    const label = compactMode && row.metricShortLabel ? row.metricShortLabel : row.metricLabel;
    const tooltip = row.metricTooltip ?? row.metricLabel;
    return (
      <span className="psi-matrix-metric-label" title={tooltip}>
        {label}
      </span>
    );
  },
});

const buildTotalColumn = (): Column<MetricRowData> => ({
  key: TOTAL_COLUMN_KEY,
  name: "Total",
  width: PSI_GRID_CONFIG.widths.total,
  frozen: true,
  headerCellClass: "psi-matrix-header psi-matrix-header--total",
  className: "psi-matrix-cell psi-matrix-cell--total",
  renderCell: ({ row }) => {
    const value = row.totalValue;
    const formatted = formatMetricValue(value);
    const trendClass = value === 0 ? "value-neutral" : value > 0 ? "value-positive" : "value-negative";
    return <span className={`psi-matrix-value ${trendClass}`}>{formatted}</span>;
  },
});

export default function CrossTableView({
  rows,
  metrics,
  orientation = "warehouse-first",
  compactMode,
  rowDensity,
}: CrossTableViewProps) {
  const columnGroups = useMemo(() => buildGroupMeta(rows, orientation), [rows, orientation]);
  const columnIds = useMemo(() => buildColumnIdList(columnGroups), [columnGroups]);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => new Set(columnIds));

  useEffect(() => {
    setVisibleColumns((previous) => {
      const next = new Set(previous);
      columnIds.forEach((id) => {
        next.add(id);
      });
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

  const metricColumn = useMemo(() => buildMetricColumn(compactMode), [compactMode]);
  const totalColumn = useMemo(() => buildTotalColumn(), []);

  const valueColumns = useMemo(() => {
    const columns: Column<MetricRowData>[] = [];
    const groupDescriptors: ColumnGroupDescriptor[] = [];

    columnGroups.forEach((group) => {
      const groupColumnKeys: string[] = [];
      if (collapsedGroups.has(group.id)) {
        const collapsedColumn = makeCollapsedGroupColumn(group, { compactMode });
        columns.push({ ...collapsedColumn, className: "psi-matrix-value-cell psi-matrix-value-cell--collapsed" });
        groupColumnKeys.push(collapsedColumn.key);
      } else {
        group.columns.forEach((meta) => {
          if (!visibleColumns.has(meta.id)) {
            return;
          }
          const column = makeValueColumn(meta, {
            compactMode,
            className: compactMode
              ? "psi-matrix-value-cell psi-matrix-value-cell--compact"
              : "psi-matrix-value-cell",
          });
          columns.push(column);
          groupColumnKeys.push(column.key);
        });
        if (groupColumnKeys.length === 0) {
          const placeholder = makeCollapsedGroupColumn(group, { compactMode });
          const placeholderKey = `${placeholder.key}::placeholder`;
          columns.push({
            ...placeholder,
            key: placeholderKey,
            renderCell: () => <span className="psi-matrix-value value-neutral">—</span>,
          });
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
  }, [columnGroups, collapsedGroups, visibleColumns, compactMode]);

  const columns = useMemo(
    () => [metricColumn, totalColumn, ...valueColumns.columns],
    [metricColumn, totalColumn, valueColumns.columns],
  );

  const columnGroupDescriptors = valueColumns.groupDescriptors;

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

  if (columns.length <= 2) {
    return <p className="psi-matrix-empty">No rows match the current filters.</p>;
  }

  const gridClassName = [
    "psi-matrix-grid",
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
    <div className="psi-matrix-view">
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
          columns={columns}
          rows={metricRows}
          rowKeyGetter={(row) => row.id}
          className="psi-matrix-rdg"
          columnGroups={columnGroupDescriptors}
          onToggleColumnGroup={handleToggleGroup}
          headerRowHeight={compactMode ? 36 : 44}
          groupHeaderRowHeight={compactMode ? 32 : 40}
          defaultColumnOptions={{ width: PSI_GRID_CONFIG.widths.value }}
        />
      </div>
    </div>
  );
}
