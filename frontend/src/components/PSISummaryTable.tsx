import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import DataGrid, { type CellClickArgs, type Column } from "react-data-grid";
import { createPortal } from "react-dom";

import { ChannelAgg, SummaryRow } from "../utils/psiSummary";

type SummaryMetricKey = keyof Pick<ChannelAgg, "inbound_sum" | "outbound_sum" | "last_closing">;

type SummaryGridRow = Record<string, string | number | boolean | null | undefined> & {
  id: string;
  sku: string;
  skuName?: string;
  metric: string;
  metricKey: SummaryMetricKey;
  groupPosition: "start" | "middle" | "end";
  isSelected: boolean;
  total: number | null;
  surplus: number | null;
  isPlaceholder?: boolean;
};

type SelectionOverlayMetrics = {
  top: number;
  height: number;
  left: number;
  width: number;
  borderColor: string;
};

type Props = {
  rows: SummaryRow[];
  onSelectSku: (sku: string | null) => void;
  selectedSku?: string | null;
  channelOrder?: string[];
};

const numberFormatter = new Intl.NumberFormat("ja-JP", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const formatValue = (value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return "—";
  }
  return numberFormatter.format(value);
};

const classNames = (...values: Array<string | false | null | undefined>) =>
  values.filter(Boolean).join(" ");

const metricLabels: { key: SummaryMetricKey; label: string }[] = [
  { key: "inbound_sum", label: "Inbound" },
  { key: "outbound_sum", label: "Outbound" },
  { key: "last_closing", label: "Stock Closing" },
];

const summaryGroupPositions: Array<"start" | "middle" | "end"> = ["start", "middle", "end"];

const maxVisibleRows = 9;
const headerHeight = 36;
// Allow enough vertical room for nine visible data rows with the current
// effective row height (including padding and borders).
const summaryBodyHeight = 468;
const baseColumnWidth = 132;
const skuColumnWidth = baseColumnWidth * 3;

const PSISummaryTable = memo(function PSISummaryTable({
  rows,
  onSelectSku,
  selectedSku,
  channelOrder,
}: Props) {
  const [metricFilter, setMetricFilter] = useState("");
  const [metricHeaderElement, setMetricHeaderElement] = useState<HTMLDivElement | null>(null);
  const [skuHeaderElement, setSkuHeaderElement] = useState<HTMLDivElement | null>(null);
  const gridContainerRef = useRef<HTMLDivElement | null>(null);
  const [selectionOverlay, setSelectionOverlay] = useState<SelectionOverlayMetrics | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  const orderedChannels = useMemo(() => {
    const unique = new Set<string>();
    rows.forEach((row) => {
      Object.keys(row.channels).forEach((channel) => {
        unique.add(channel);
      });
    });

    const channels = Array.from(unique);

    if (!channelOrder || !channelOrder.length) {
      return channels.sort((a, b) => a.localeCompare(b));
    }

    const priority = new Map(channelOrder.map((channel, index) => [channel, index] as const));

    return channels.sort((a, b) => {
      const aPriority = priority.has(a) ? priority.get(a)! : Number.POSITIVE_INFINITY;
      const bPriority = priority.has(b) ? priority.get(b)! : Number.POSITIVE_INFINITY;
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      return a.localeCompare(b);
    });
  }, [rows, channelOrder]);

  const gridRows = useMemo(() => {
    const summaryRows: SummaryGridRow[] = [];
    rows.forEach((row) => {
      metricLabels.forEach((metric, index) => {
        const channelValues: Record<string, number | null> = {};
        orderedChannels.forEach((channel) => {
          const channelAgg = row.channels[channel];
          if (!channelAgg) {
            channelValues[channel] = null;
            return;
          }
          const value = channelAgg[metric.key as keyof ChannelAgg];
          channelValues[channel] = typeof value === "number" ? value : value ?? null;
        });

        const totalAccumulator = orderedChannels.reduce(
          (accumulator, channel) => {
            const value = channelValues[channel];
            if (typeof value === "number" && Number.isFinite(value)) {
              accumulator.sum += value;
              accumulator.hasValue = true;
            }
            return accumulator;
          },
          { sum: 0, hasValue: false }
        );

        let surplus: number | null = null;
        if (metric.key === "last_closing") {
          const surplusAccumulator = orderedChannels.reduce(
            (accumulator, channel) => {
              const channelAgg = row.channels[channel];
              if (!channelAgg) {
                return accumulator;
              }
              const movable = channelAgg.last_movable_stock;
              if (typeof movable === "number" && Number.isFinite(movable)) {
                accumulator.sum += movable;
                accumulator.hasValue = true;
              }
              return accumulator;
            },
            { sum: 0, hasValue: false }
          );
          surplus = surplusAccumulator.hasValue ? surplusAccumulator.sum : null;
        }

        summaryRows.push({
          id: `${row.sku_code}-${metric.key}`,
          sku: row.sku_code,
          skuName: row.sku_name ?? undefined,
          metric: metric.label,
          metricKey: metric.key,
          groupPosition: summaryGroupPositions[index] ?? "middle",
          isSelected: row.sku_code === selectedSku,
          total: totalAccumulator.hasValue ? totalAccumulator.sum : null,
          surplus,
          ...channelValues,
        });
      });
    });

    return summaryRows;
  }, [rows, orderedChannels, selectedSku]);

  const normalizedMetricFilter = metricFilter.trim().toLowerCase();

  const filteredRows = useMemo(() => {
    if (!normalizedMetricFilter) {
      return gridRows;
    }

    return gridRows.filter((row) => row.metric.toLowerCase().includes(normalizedMetricFilter));
  }, [gridRows, normalizedMetricFilter]);

  const paddedRows = useMemo(() => {
    if (filteredRows.length >= maxVisibleRows) {
      return filteredRows;
    }

    const placeholdersNeeded = maxVisibleRows - filteredRows.length;
    const placeholders: SummaryGridRow[] = [];

    for (let index = 0; index < placeholdersNeeded; index += 1) {
      const position = summaryGroupPositions[(filteredRows.length + index) % summaryGroupPositions.length];
      const placeholder: SummaryGridRow = {
        id: `placeholder-${index}`,
        sku: "",
        metric: "",
        metricKey: metricLabels[index % metricLabels.length].key,
        groupPosition: position,
        isSelected: false,
        total: null,
        surplus: null,
        isPlaceholder: true,
      };

      orderedChannels.forEach((channel) => {
        placeholder[channel] = null;
      });

      placeholders.push(placeholder);
    }

    return [...filteredRows, ...placeholders];
  }, [filteredRows, orderedChannels]);

  const valueClassName = useCallback(
    (row: SummaryGridRow, key: string) => {
      if (row.isPlaceholder) {
        return classNames("psi-grid-value-cell", "psi-summary-cell-placeholder");
      }

      const rawValue = row[key];
      const numericValue = typeof rawValue === "number" ? rawValue : null;
      const isStockClosing = row.metricKey === "last_closing";
      const isNegative = numericValue !== null && numericValue < 0;

      return classNames(
        "psi-grid-value-cell",
        row.groupPosition && `psi-grid-group-${row.groupPosition}`,
        row.isSelected && "psi-summary-cell-selected",
        isNegative && "psi-grid-value-negative",
        isStockClosing && isNegative && "psi-grid-stock-warning"
      );
    },
    []
  );

  const handleMetricHeaderRef = useCallback((element: HTMLDivElement | null) => {
    setMetricHeaderElement(element);
  }, []);

  const handleSkuHeaderRef = useCallback((element: HTMLDivElement | null) => {
    setSkuHeaderElement(element);
  }, []);

  const updateSelectionOverlay = useCallback(() => {
    const container = gridContainerRef.current;
    if (!container) {
      setSelectionOverlay(null);
      return;
    }

    const gridElement = container.querySelector<HTMLElement>(".rdg");
    if (!gridElement) {
      setSelectionOverlay(null);
      return;
    }

    const selectedRows = gridElement.querySelectorAll<HTMLElement>(".psi-summary-row-selected");
    if (selectedRows.length === 0) {
      setSelectionOverlay((previous) => (previous === null ? previous : null));
      return;
    }

    const containerRect = container.getBoundingClientRect();
    const gridRect = gridElement.getBoundingClientRect();
    const gridComputedStyle = window.getComputedStyle(gridElement);
    const selectionOutlineColor = gridComputedStyle
      .getPropertyValue("--psi-grid-selection-outline")
      .trim();
    const borderColor = selectionOutlineColor || "rgba(250, 204, 21, 0.8)";
    const firstRowRect = selectedRows[0].getBoundingClientRect();
    const lastRowRect = selectedRows[selectedRows.length - 1].getBoundingClientRect();

    const outlineOffset = 1;
    const overlayMetrics: SelectionOverlayMetrics = {
      top: firstRowRect.top - containerRect.top - outlineOffset,
      height: lastRowRect.bottom - firstRowRect.top + outlineOffset * 2,
      left: gridRect.left - containerRect.left - outlineOffset,
      width: gridRect.width + outlineOffset * 2,
      borderColor,
    };

    setSelectionOverlay((previous) => {
      if (
        previous &&
        Math.abs(previous.top - overlayMetrics.top) < 0.5 &&
        Math.abs(previous.height - overlayMetrics.height) < 0.5 &&
        Math.abs(previous.left - overlayMetrics.left) < 0.5 &&
        Math.abs(previous.width - overlayMetrics.width) < 0.5 &&
        previous.borderColor === overlayMetrics.borderColor
      ) {
        return previous;
      }
      return overlayMetrics;
    });
  }, []);

  const scheduleSelectionOverlayUpdate = useCallback(() => {
    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      updateSelectionOverlay();
    });
  }, [updateSelectionOverlay]);

  useLayoutEffect(() => {
    scheduleSelectionOverlayUpdate();
  }, [paddedRows, scheduleSelectionOverlayUpdate]);

  useLayoutEffect(() => {
    const container = gridContainerRef.current;
    if (!container) {
      return;
    }

    const viewport = container.querySelector<HTMLElement>(".rdg-viewport");
    if (!viewport) {
      updateSelectionOverlay();
      return;
    }

    let animationFrame: number | null = null;
    const handleScrollOrResize = () => {
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }
        animationFrame = window.requestAnimationFrame(() => {
          animationFrame = null;
          updateSelectionOverlay();
        });
    };

    viewport.addEventListener("scroll", handleScrollOrResize, { passive: true });
    window.addEventListener("resize", handleScrollOrResize);

    return () => {
      viewport.removeEventListener("scroll", handleScrollOrResize);
      window.removeEventListener("resize", handleScrollOrResize);
      if (animationFrame !== null) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [updateSelectionOverlay, paddedRows]);

  const columns = useMemo<Column<SummaryGridRow>[]>(() => {
    const skuColumn: Column<SummaryGridRow> = {
      key: "sku",
      name: "SKU",
      width: skuColumnWidth,
      frozen: true,
      setHeaderRef: handleSkuHeaderRef,
      className: (row) =>
        classNames(
          "psi-grid-summary-sku-cell",
          !row.isPlaceholder && row.groupPosition && `psi-grid-group-${row.groupPosition}`,
          !row.isPlaceholder && row.groupPosition !== "start" && "psi-grid-cell-duplicate",
          row.isSelected && "psi-summary-cell-selected",
          row.isPlaceholder && "psi-summary-cell-placeholder"
        ),
      renderCell: ({ row }) => (
        <div className="psi-grid-summary-sku" aria-hidden={row.isPlaceholder ? "true" : undefined}>
          {!row.isPlaceholder && (
            <>
              <div className="psi-grid-summary-sku-code">{row.sku}</div>
              {row.skuName && <div className="psi-grid-summary-sku-name">{row.skuName}</div>}
            </>
          )}
        </div>
      ),
    };

    const metricColumn: Column<SummaryGridRow> = {
      key: "metric",
      name: "",
      width: baseColumnWidth,
      frozen: true,
      className: (row) =>
        classNames(
          "psi-grid-summary-metric-cell",
          !row.isPlaceholder && row.groupPosition && `psi-grid-group-${row.groupPosition}`,
          row.isSelected && "psi-summary-cell-selected",
          row.isPlaceholder && "psi-summary-cell-placeholder"
        ),
      setHeaderRef: handleMetricHeaderRef,
    };

    const channelColumns = orderedChannels.map((channel) => ({
      key: channel,
      name: channel,
      width: baseColumnWidth,
      className: (row: SummaryGridRow) => valueClassName(row, channel),
      headerCellClass: "psi-grid-header-numeric",
      renderCell: ({ row }: { row: SummaryGridRow }) =>
        row.isPlaceholder ? "" : formatValue(row[channel] as number | null | undefined),
    }));

    const surplusColumn: Column<SummaryGridRow> = {
      key: "surplus",
      name: "余剰在庫",
      width: baseColumnWidth,
      className: (row) => valueClassName(row, "surplus"),
      headerCellClass: "psi-grid-header-numeric",
      renderCell: ({ row }) => (row.isPlaceholder ? "" : formatValue(row.surplus as number | null | undefined)),
    };

    const totalColumn: Column<SummaryGridRow> = {
      key: "total",
      name: "合計",
      width: baseColumnWidth,
      className: (row) => valueClassName(row, "total"),
      headerCellClass: "psi-grid-header-numeric",
      renderCell: ({ row }) => (row.isPlaceholder ? "" : formatValue(row.total as number | null | undefined)),
    };

    return [skuColumn, metricColumn, ...channelColumns, surplusColumn, totalColumn];
  }, [handleMetricHeaderRef, handleSkuHeaderRef, orderedChannels, valueClassName]);

  useEffect(() => {
    return () => {
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  const metricHeaderPortal =
    metricHeaderElement &&
    createPortal(
      <div className="psi-grid-header-filter">
        <span>Metric</span>
        <div className="psi-grid-header-filter-controls">
          <input
            type="text"
            value={metricFilter}
            onChange={(event) => setMetricFilter(event.target.value)}
            placeholder="フィルタ"
            aria-label="Metricをフィルタ"
          />
        </div>
      </div>,
      metricHeaderElement
    );

  const skuHeaderPortal =
    skuHeaderElement &&
    createPortal(
      <div className="psi-grid-header-selection">
        <button
          type="button"
          onClick={() => {
            onSelectSku(null);
            scheduleSelectionOverlayUpdate();
          }}
          disabled={!selectedSku}
        >
          選択解除
        </button>
      </div>,
      skuHeaderElement
    );

  const handleCellClick = useCallback(
    ({ row, event }: CellClickArgs<SummaryGridRow>) => {
      if (row.isPlaceholder) {
        return;
      }
      if (event.altKey || event.metaKey) {
        event.preventDefault();
        event.stopPropagation();
        onSelectSku(row.isSelected ? null : row.sku);
        scheduleSelectionOverlayUpdate();
        return;
      }

      if (!row.isSelected) {
        onSelectSku(row.sku);
        scheduleSelectionOverlayUpdate();
        return;
      }

      // Already selected: keep selection unchanged but refresh the overlay for immediate feedback.
      scheduleSelectionOverlayUpdate();
    },
    [onSelectSku, scheduleSelectionOverlayUpdate]
  );

  const getRowClassName = useCallback(
    (row: SummaryGridRow) => {
      if (row.isPlaceholder) {
        return "psi-summary-row-placeholder";
      }
      if (!row.isSelected) {
        return undefined;
      }
      const positionClass = row.groupPosition
        ? `psi-summary-row-selected-${row.groupPosition}`
        : undefined;
      return classNames("psi-summary-row-selected", positionClass);
    },
    []
  );

  if (!gridRows.length) {
    return null;
  }

  const gridHeight = headerHeight + summaryBodyHeight;

  return (
    <div className="psi-summary-grid" ref={gridContainerRef}>
      {selectionOverlay && (
        <div
          className="psi-summary-selection-overlay"
          style={{
            top: `${selectionOverlay.top}px`,
            left: `${selectionOverlay.left}px`,
            width: `${selectionOverlay.width}px`,
            height: `${selectionOverlay.height}px`,
            borderColor: selectionOverlay.borderColor,
          }}
        />
      )}
      {skuHeaderPortal}
      {metricHeaderPortal}
      <DataGrid
        columns={columns}
        rows={paddedRows}
        rowKeyGetter={(row) => row.id}
        onCellClick={handleCellClick}
        defaultColumnOptions={{ width: baseColumnWidth }}
        className="psi-data-grid psi-summary-data-grid"
        style={{ blockSize: `${gridHeight}px` }}
        rowClassName={getRowClassName}
      />
    </div>
  );
});

export default PSISummaryTable;
