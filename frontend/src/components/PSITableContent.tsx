import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import DataGrid, { type CellClickArgs, type Column, type RenderEditCellProps, type RowsChangeData } from "react-data-grid";
import { createPortal } from "react-dom";

import {
  EditableField,
  MetricDefinition,
  PSIEditableChannel,
  PSIGridRow,
  MetricKey,
} from "../pages/psiTableTypes";

interface PSITableContentProps {
  sessionId: string;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  tableData: PSIEditableChannel[];
  hasAnyData: boolean;
  selectedSku: string | null;
  visibleMetrics: MetricDefinition[];
  allDates: string[];
  todayIso: string;
  formatDisplayDate: (iso: string) => string;
  onDownload: () => void;
  canDownload: boolean;
  applyError: string | null;
  applySuccess: string | null;
  formatNumber: (value?: number | null) => string;
  makeChannelKey: (channel: { sku_code: string; warehouse_name: string; channel: string }) => string;
  onEditableChange: (channelKey: string, date: string, field: EditableField, rawValue: string) => void;
  onRegisterScrollToDate?: (handler: (date: string) => void) => (() => void) | void;
  onChannelCellClick?: (row: PSIGridRow) => void;
}

const editableFields: EditableField[] = ["inbound_qty", "outbound_qty", "safety_stock"];
const editableFieldSet = new Set<EditableField>(editableFields);

const classNames = (...values: Array<string | false | null | undefined>) => values.filter(Boolean).join(" ");

const isEditableField = (key: MetricKey): key is EditableField => editableFieldSet.has(key as EditableField);

const toInputValue = (input: number | null | undefined) =>
  input === null || input === undefined ? "" : String(input);

function NumberEditor({ row, column, onRowChange, onClose }: RenderEditCellProps<PSIGridRow>) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const initialValue = row[column.key] as number | null | undefined;
  const [value, setValue] = useState(() => toInputValue(initialValue));

  useEffect(() => {
    setValue(toInputValue(initialValue));
  }, [initialValue]);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  if (!row.metricEditable) {
    onClose(false);
    return null;
  }

  const commit = () => {
    const trimmed = value.trim();
    if (trimmed === "") {
      onRowChange({ ...row, [column.key]: null }, true);
      return;
    }
    const parsed = Number(trimmed);
    if (!Number.isFinite(parsed)) {
      onClose(false);
      return;
    }
    onRowChange({ ...row, [column.key]: parsed }, true);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      commit();
    } else if (event.key === "Escape") {
      event.preventDefault();
      onClose(false);
    }
  };

  return (
    <input
      ref={inputRef}
      className="psi-grid-editor"
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={handleKeyDown}
    />
  );
}

const PSITableContent = ({
  sessionId,
  isLoading,
  isError,
  errorMessage,
  tableData,
  hasAnyData,
  selectedSku,
  visibleMetrics,
  allDates,
  todayIso,
  formatDisplayDate,
  onDownload,
  canDownload,
  applyError,
  applySuccess,
  formatNumber,
  makeChannelKey,
  onEditableChange,
  onRegisterScrollToDate,
  onChannelCellClick,
}: PSITableContentProps) => {
  const [activeWarehouse, setActiveWarehouse] = useState<string | null>(null);
  const [metricFilter, setMetricFilter] = useState("");
  const [metricHeaderElement, setMetricHeaderElement] = useState<HTMLDivElement | null>(null);
  const headerRefs = useRef(new Map<string, HTMLDivElement>());
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const warehouses = useMemo(() => {
    if (!tableData.length || !visibleMetrics.length) {
      return [] as Array<{ name: string; channelCount: number; rows: PSIGridRow[] }>;
    }

    const grouping = new Map<string, PSIEditableChannel[]>();
    tableData.forEach((channel) => {
      const key = channel.warehouse_name;
      const list = grouping.get(key);
      if (list) {
        list.push(channel);
      } else {
        grouping.set(key, [channel]);
      }
    });

    return Array.from(grouping.entries()).map(([warehouseName, channels]) => {
      const rows: PSIGridRow[] = [];
      channels.forEach((channel) => {
        const channelKey = makeChannelKey(channel);
        const dateMap = new Map(channel.daily.map((entry) => [entry.date, entry]));
        visibleMetrics.forEach((metric) => {
          const metricKey = metric.key as MetricKey;
          const row: PSIGridRow = {
            id: `${channelKey}__${metricKey}`,
            channelKey,
            sku_code: channel.sku_code,
            warehouse_name: channel.warehouse_name,
            channel: channel.channel,
            metric: metric.label,
            metricKey,
            metricEditable: metric.editable === true,
          };

          allDates.forEach((date) => {
            const dailyEntry = dateMap.get(date);
            const value = dailyEntry ? (dailyEntry[metricKey as keyof typeof dailyEntry] as number | null | undefined) : null;
            row[date] = value ?? null;
          });

          rows.push(row);
        });
      });

      return {
        name: warehouseName,
        channelCount: channels.length,
        rows,
      };
    });
  }, [allDates, makeChannelKey, tableData, visibleMetrics]);

  useEffect(() => {
    if (!warehouses.length) {
      setActiveWarehouse(null);
      return;
    }
    if (!activeWarehouse || !warehouses.some((item) => item.name === activeWarehouse)) {
      setActiveWarehouse(warehouses[0].name);
    }
  }, [activeWarehouse, warehouses]);

  useEffect(() => {
    const refMap = headerRefs.current;
    refMap.forEach((_, key) => {
      if (!allDates.includes(key)) {
        refMap.delete(key);
      }
    });
  }, [allDates]);

  const activeWarehouseData = useMemo(
    () => warehouses.find((item) => item.name === activeWarehouse) ?? null,
    [activeWarehouse, warehouses]
  );

  const allRows = activeWarehouseData?.rows ?? [];
  const normalizedMetricFilter = metricFilter.trim().toLowerCase();

  const rows = useMemo(() => {
    if (!normalizedMetricFilter) {
      return allRows;
    }

    return allRows.filter((row) =>
      String(row.metric).toLowerCase().includes(normalizedMetricFilter)
    );
  }, [allRows, normalizedMetricFilter]);

  const handleMetricHeaderRef = useCallback((element: HTMLDivElement | null) => {
    setMetricHeaderElement(element);
  }, []);

  const baseColumns = useMemo<Column<PSIGridRow>[]>(
    () => [
      {
        key: "channel",
        name: "Channel",
        width: 180,
        frozen: true,
        className: "psi-grid-channel-cell",
      },
      {
        key: "metric",
        name: "",
        width: 160,
        frozen: true,
        className: "psi-grid-metric-cell",
        setHeaderRef: handleMetricHeaderRef,
      },
    ],
    [handleMetricHeaderRef]
  );

  const duplicateCellMap = useMemo(() => {
    if (rows.length === 0) {
      return new Map<string, Set<string>>();
    }

    const metricIndex = baseColumns.findIndex((column) => column.key === "metric");
    if (metricIndex <= 0) {
      return new Map<string, Set<string>>();
    }

    const targetKeys = baseColumns.slice(0, metricIndex).map((column) => column.key);
    if (!targetKeys.length) {
      return new Map<string, Set<string>>();
    }

    const duplicates = new Map<string, Set<string>>();

    for (let index = 1; index < rows.length; index += 1) {
      const currentRow = rows[index];
      const previousRow = rows[index - 1];
      if (!previousRow || currentRow.channelKey !== previousRow.channelKey) {
        continue;
      }

      for (const columnKey of targetKeys) {
        const currentValue = currentRow[columnKey];
        if (
          currentValue !== null &&
          currentValue !== undefined &&
          (typeof currentValue !== "string" || currentValue.trim() !== "") &&
          currentValue === previousRow[columnKey]
        ) {
          let entry = duplicates.get(currentRow.id);
          if (!entry) {
            entry = new Set<string>();
            duplicates.set(currentRow.id, entry);
          }
          entry.add(columnKey);
        }
      }
    }

    return duplicates;
  }, [baseColumns, rows]);

  const handleHeaderRef = useCallback((key: string, element: HTMLDivElement | null) => {
    const map = headerRefs.current;
    if (element) {
      map.set(key, element);
    } else {
      map.delete(key);
    }
  }, []);

  const dateColumns = useMemo<Column<PSIGridRow>[]>(
    () =>
      allDates.map((date) => {
        const isToday = date === todayIso;
        return {
          key: date,
          name: formatDisplayDate(date),
          width: 132,
          className: (row: PSIGridRow) => {
            const cellValue = row[date] as number | null | undefined;
            const numericValue = typeof cellValue === "number" ? cellValue : null;
            const isNegativeValue = numericValue !== null && numericValue < 0;
            const showStockWarning = row.metricKey === "stock_closing" && isNegativeValue;
            return classNames(
              "psi-grid-value-cell",
              row.metricEditable && "psi-grid-cell-editable",
              isToday && "psi-grid-cell-today",
              isNegativeValue && "psi-grid-value-negative",
              showStockWarning && "psi-grid-stock-warning"
            );
          },
          headerCellClass: classNames("psi-grid-date-header", isToday && "psi-grid-header-today"),
          renderCell: ({ row }) => formatNumber(row[date] as number | null | undefined),
          renderEditCell: (props) => <NumberEditor {...props} />,
          editorOptions: {
            editOnClick: true,
          },
          setHeaderRef: (element: HTMLDivElement | null) => handleHeaderRef(date, element),
        } satisfies Column<PSIGridRow>;
      }),
    [allDates, formatDisplayDate, formatNumber, handleHeaderRef, todayIso]
  );

  const columns = useMemo(() => {
    if (duplicateCellMap.size === 0) {
      return [...baseColumns, ...dateColumns];
    }

    const metricIndex = baseColumns.findIndex((column) => column.key === "metric");

    const enhancedBaseColumns =
      metricIndex > 0
        ? baseColumns.map((column, columnIndex) => {
            if (columnIndex >= metricIndex) {
              return column;
            }

            const { className } = column;
            return {
              ...column,
              className: (row: PSIGridRow) =>
                classNames(
                  typeof className === "function" ? className(row) : className,
                  duplicateCellMap.get(row.id)?.has(column.key) && "psi-grid-cell-duplicate"
                ),
            } satisfies Column<PSIGridRow>;
          })
        : baseColumns;

    return [...enhancedBaseColumns, ...dateColumns];
  }, [baseColumns, dateColumns, duplicateCellMap]);

  const metricHeaderPortal =
    metricHeaderElement &&
    createPortal(
      <div className="psi-grid-header-filter">
        <span>Metric</span>
        <input
          type="text"
          value={metricFilter}
          onChange={(event) => setMetricFilter(event.target.value)}
          placeholder="フィルタ"
          aria-label="Metricをフィルタ"
        />
      </div>,
      metricHeaderElement
    );

  const handleRowsChange = useCallback(
    (updatedRows: PSIGridRow[], data: RowsChangeData<PSIGridRow>) => {
      if (!data?.column) {
        return;
      }
      const columnKey = data.column.key;
      if (!allDates.includes(columnKey)) {
        return;
      }
      const rowIndex = data.indexes[0];
      const updatedRow = updatedRows[rowIndex];
      if (!updatedRow || !updatedRow.metricEditable || !isEditableField(updatedRow.metricKey)) {
        return;
      }
      const value = updatedRow[columnKey];
      const rawValue = value === null || value === undefined ? "" : String(value);
      onEditableChange(updatedRow.channelKey, columnKey, updatedRow.metricKey, rawValue);
    },
    [allDates, onEditableChange]
  );

  const handleCellClick = useCallback(
    (args: CellClickArgs<PSIGridRow>) => {
      if (args.column.key === "channel") {
        onChannelCellClick?.(args.row);
      }
    },
    [onChannelCellClick]
  );

  const scrollToDate = useCallback(
    (targetDate: string) => {
      const viewport = viewportRef.current;
      const headerCell = headerRefs.current.get(targetDate);
      if (!viewport || !headerCell) {
        return;
      }
      const viewportRect = viewport.getBoundingClientRect();
      const cellRect = headerCell.getBoundingClientRect();
      const offset = cellRect.left - viewportRect.left;
      const nextScrollLeft = viewport.scrollLeft + offset - viewport.clientWidth / 2 + cellRect.width / 2;
      viewport.scrollTo({ left: Math.max(0, nextScrollLeft), behavior: "smooth" });
    },
    []
  );

  useEffect(() => {
    if (!onRegisterScrollToDate) {
      return;
    }
    const cleanup = onRegisterScrollToDate(scrollToDate);
    return () => {
      if (cleanup) {
        cleanup();
      }
    };
  }, [onRegisterScrollToDate, scrollToDate]);

  const hasRows = allRows.length > 0 && visibleMetrics.length > 0 && allDates.length > 0;
  const showSelectionPlaceholder = !selectedSku && hasAnyData;
  const showNoDataMessage = !hasAnyData && sessionId && !isLoading;
  const showNoMetricsMessage = Boolean(selectedSku && visibleMetrics.length === 0);
  const showNoDatesMessage = Boolean(selectedSku && visibleMetrics.length > 0 && allDates.length === 0);

  return (
    <section className="psi-table-section">
      {isLoading && sessionId && <p className="psi-table-status">Loading PSI data...</p>}
      {isError && <p className="psi-table-status error">{errorMessage}</p>}
      {hasRows ? (
        <div className="psi-table-wrapper">
          <div className="psi-table-toolbar">
            <div className="psi-table-toolbar-group">
              <button
                type="button"
                className="psi-button secondary"
                onClick={onDownload}
                disabled={!canDownload}
                aria-label="CSVをダウンロード"
              >
                <span>CSV</span>
              </button>
            </div>
            {(applyError || applySuccess) && (
              <div className="psi-table-messages">
                {applyError && <span className="error">{applyError}</span>}
                {applySuccess && <span className="success">{applySuccess}</span>}
              </div>
            )}
          </div>
          <div className="psi-warehouse-tabs" role="tablist" aria-label="Warehouses">
            {warehouses.map((item) => {
              const isActive = item.name === activeWarehouse;
              return (
                <button
                  key={item.name}
                  type="button"
                  role="tab"
                  className={classNames("psi-warehouse-tab", isActive && "active")}
                  aria-selected={isActive}
                  onClick={() => setActiveWarehouse(item.name)}
                >
                  {item.name} ({item.channelCount})
                </button>
              );
            })}
          </div>
          <div className="psi-grid-container">
            {metricHeaderPortal}
            <DataGrid
              columns={columns}
              rows={rows}
              rowKeyGetter={(row) => row.id}
              onRowsChange={handleRowsChange}
              onCellClick={handleCellClick}
              defaultColumnOptions={{ width: 132 }}
              viewportRef={viewportRef}
              style={{ blockSize: "calc(100vh - 320px)" }}
              className="psi-data-grid"
            />
          </div>
        </div>
      ) : showSelectionPlaceholder ? (
        <p className="psi-table-status">上段の集計からSKUを選択してください。</p>
      ) : showNoDataMessage ? (
        <p className="psi-table-status">No PSI data for the current filters.</p>
      ) : showNoMetricsMessage ? (
        <p className="psi-table-status">表示するメトリクスが選択されていません。</p>
      ) : (
        showNoDatesMessage && <p className="psi-table-status">選択した期間の日付が見つかりません。</p>
      )}
    </section>
  );
};

export default PSITableContent;
