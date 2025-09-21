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

type SummaryRowType = "skuHeader" | "metric";

type SummaryGroupPosition = "start" | "middle" | "end";

type SummaryGridRow = Record<string, string | number | boolean | null | undefined> & {
  id: string;
  rowType: SummaryRowType;
  sku: string;
  skuName?: string;
  metric: string;
  metricKey?: SummaryMetricKey;
  groupPosition: SummaryGroupPosition;
  isSelected: boolean;
  total: number | null;
  surplus: number | null;
  isPlaceholder?: boolean;
  collapsed?: boolean;
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

const metricGroupPositions: SummaryGroupPosition[] = ["middle", "middle", "end"];
const rowsPerGroup = metricGroupPositions.length + 1;
const maxVisibleRows = rowsPerGroup * 3;
const headerHeight = 36;
const summaryBodyHeight = 432;
const baseColumnWidth = 132;
const metricColumnWidth = 152;
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
  const [collapsedSkus, setCollapsedSkus] = useState<Record<string, boolean>>({});

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

  useEffect(() => {
    setCollapsedSkus((previous) => {
      if (!rows.length) {
        return Object.keys(previous).length ? {} : previous;
      }
      const valid = new Set(rows.map((row) => row.sku_code));
      const next: Record<string, boolean> = {};
      valid.forEach((sku) => {
        if (previous[sku]) {
          next[sku] = true;
        }
      });
      if (Object.keys(previous).length === Object.keys(next).length) {
        return previous;
      }
      return next;
    });
  }, [rows]);

  const toggleSkuCollapse = useCallback((sku: string) => {
    setCollapsedSkus((previous) => {
      if (previous[sku]) {
        const { [sku]: _removed, ...rest } = previous;
        return rest;
      }
      return { ...previous, [sku]: true };
    });
  }, []);

  const normalizedMetricFilter = metricFilter.trim().toLowerCase();

  const summaryGroups = useMemo(() => {
    if (!rows.length) {
      return [] as Array<{ header: SummaryGridRow; metrics: SummaryGridRow[] }>;
    }

    return rows.reduce<Array<{ header: SummaryGridRow; metrics: SummaryGridRow[] }>>(
      (groups, row) => {
        const isSelected = row.sku_code === selectedSku;
        const isCollapsed = collapsedSkus[row.sku_code] ?? false;
        const headerRow: SummaryGridRow = {
          id: `${row.sku_code}-header`,
          rowType: "skuHeader",
          sku: row.sku_code,
          skuName: row.sku_name ?? undefined,
          metric: "",
          groupPosition: "start",
          isSelected,
          total: null,
          surplus: null,
          collapsed: isCollapsed,
        };

        orderedChannels.forEach((channel) => {
          headerRow[channel] = null;
        });

        const metricRows = metricLabels.map((metric, index) => {
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

          const metricRow: SummaryGridRow = {
            id: `${row.sku_code}-${metric.key}`,
            rowType: "metric",
            sku: row.sku_code,
            skuName: row.sku_name ?? undefined,
            metric: metric.label,
            metricKey: metric.key,
            groupPosition: metricGroupPositions[index] ?? "middle",
            isSelected,
            total: totalAccumulator.hasValue ? totalAccumulator.sum : null,
            surplus,
          };

          orderedChannels.forEach((channel) => {
            metricRow[channel] = channelValues[channel];
          });

          return metricRow;
        });

        const visibleMetrics = normalizedMetricFilter
          ? metricRows.filter((metricRow) =>
              metricRow.metric.toLowerCase().includes(normalizedMetricFilter)
            )
          : metricRows;

        if (normalizedMetricFilter && visibleMetrics.length === 0) {
          return groups;
        }

        const adjustedMetrics = visibleMetrics.map((metricRow, index, array) => {
          const position: SummaryGroupPosition = index === array.length - 1 ? "end" : "middle";
          return { ...metricRow, groupPosition: position };
        });

        groups.push({ header: headerRow, metrics: adjustedMetrics });
        return groups;
      },
      []
    );
  }, [rows, orderedChannels, selectedSku, collapsedSkus, normalizedMetricFilter]);

  const visibleRows = useMemo(() => {
    if (!summaryGroups.length) {
      return [] as SummaryGridRow[];
    }

    return summaryGroups.reduce<SummaryGridRow[]>((list, group) => {
      list.push(group.header);
      if (!(group.header.collapsed ?? false)) {
        list.push(...group.metrics);
      }
      return list;
    }, []);
  }, [summaryGroups]);

  const paddedRows = useMemo(() => {
    if (visibleRows.length >= maxVisibleRows) {
      return visibleRows;
    }

    const placeholdersNeeded = maxVisibleRows - visibleRows.length;
    const placeholders: SummaryGridRow[] = [];
    const placeholderPattern: Array<{
      rowType: SummaryRowType;
      metricKey?: SummaryMetricKey;
      groupPosition: SummaryGroupPosition;
    }> = [
      { rowType: "skuHeader", groupPosition: "start" },
      { rowType: "metric", metricKey: "inbound_sum", groupPosition: "middle" },
      { rowType: "metric", metricKey: "outbound_sum", groupPosition: "middle" },
      { rowType: "metric", metricKey: "last_closing", groupPosition: "end" },
    ];

    for (let index = 0; index < placeholdersNeeded; index += 1) {
      const pattern = placeholderPattern[index % placeholderPattern.length];
      const metricLabel =
        pattern.metricKey && metricLabels.find((item) => item.key === pattern.metricKey)?.label;
      const placeholder: SummaryGridRow = {
        id: `placeholder-${index}`,
        rowType: pattern.rowType,
        sku: "",
        metric: metricLabel ?? "",
        metricKey: pattern.metricKey,
        groupPosition: pattern.groupPosition,
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

    return [...visibleRows, ...placeholders];
  }, [visibleRows, orderedChannels]);

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
      renderCell: ({ row }) => {
        if (row.rowType === "skuHeader") {
          if (row.isPlaceholder) {
            return (
              <div className="psi-grid-summary-sku-group" aria-hidden="true">
                <span className="psi-grid-summary-sku-toggle" aria-hidden="true">
                  <span className="psi-grid-summary-sku-toggle-icon">▼</span>
                </span>
                <div className="psi-grid-summary-sku" />
              </div>
            );
          }

          const collapsed = row.collapsed ?? false;
          return (
            <div className="psi-grid-summary-sku-group">
              <button
                type="button"
                className="psi-grid-summary-sku-toggle"
                aria-label={`${collapsed ? "Expand" : "Collapse"} ${row.sku}`}
                aria-expanded={!collapsed}
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  toggleSkuCollapse(row.sku);
                  scheduleSelectionOverlayUpdate();
                }}
              >
                <span className="psi-grid-summary-sku-toggle-icon" aria-hidden="true">
                  {collapsed ? "▶" : "▼"}
                </span>
              </button>
              <div className="psi-grid-summary-sku">
                <div className="psi-grid-summary-sku-code">{row.sku}</div>
                {row.skuName && <div className="psi-grid-summary-sku-name">{row.skuName}</div>}
              </div>
            </div>
          );
        }

        return <div className="psi-grid-summary-sku" aria-hidden="true" />;
      },
    };

    const metricColumn: Column<SummaryGridRow> = {
      key: "metric",
      name: "",
      width: metricColumnWidth,
      frozen: true,
      className: (row) =>
        classNames(
          "psi-grid-summary-metric-cell",
          !row.isPlaceholder && row.groupPosition && `psi-grid-group-${row.groupPosition}`,
          row.isSelected && "psi-summary-cell-selected",
          row.isPlaceholder && "psi-summary-cell-placeholder"
        ),
      renderCell: ({ row }) => (row.rowType === "metric" && !row.isPlaceholder ? row.metric : ""),
      setHeaderRef: handleMetricHeaderRef,
    };

    const channelColumns = orderedChannels.map((channel) => ({
      key: channel,
      name: channel,
      width: baseColumnWidth,
      className: (row: SummaryGridRow) => valueClassName(row, channel),
      headerCellClass: "psi-grid-header-numeric",
      renderCell: ({ row }: { row: SummaryGridRow }) => {
        if (row.isPlaceholder || row.rowType === "skuHeader") {
          return "";
        }
        return formatValue(row[channel] as number | null | undefined);
      },
    }));

    const surplusColumn: Column<SummaryGridRow> = {
      key: "surplus",
      name: "余剰在庫",
      width: baseColumnWidth,
      className: (row) => valueClassName(row, "surplus"),
      headerCellClass: "psi-grid-header-numeric",
      renderCell: ({ row }) =>
        row.isPlaceholder || row.rowType === "skuHeader"
          ? ""
          : formatValue(row.surplus as number | null | undefined),
    };

    const totalColumn: Column<SummaryGridRow> = {
      key: "total",
      name: "合計",
      width: baseColumnWidth,
      className: (row) => valueClassName(row, "total"),
      headerCellClass: "psi-grid-header-numeric",
      renderCell: ({ row }) =>
        row.isPlaceholder || row.rowType === "skuHeader"
          ? ""
          : formatValue(row.total as number | null | undefined),
    };

    return [skuColumn, metricColumn, ...channelColumns, surplusColumn, totalColumn];
  }, [
    handleMetricHeaderRef,
    handleSkuHeaderRef,
    orderedChannels,
    scheduleSelectionOverlayUpdate,
    toggleSkuCollapse,
    valueClassName,
  ]);

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

  if (!rows.length) {
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
        className="psi-rdg psi-data-grid psi-summary-data-grid"
        style={{ blockSize: `${gridHeight}px` }}
        rowClassName={getRowClassName}
      />
    </div>
  );
});

export default PSISummaryTable;
