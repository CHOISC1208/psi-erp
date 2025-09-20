import { MutableRefObject, useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import {
  EditableField,
  MetricDefinition,
  MetricKey,
  PSIEditableChannel,
  PSIEditableDay,
  isEditableMetric,
} from "../pages/psiTableTypes";

interface PSITableSplitProps {
  tableData: PSIEditableChannel[];
  baselineMap: Map<string, PSIEditableDay>;
  visibleMetrics: MetricDefinition[];
  metricDefinitions: MetricDefinition[];
  visibleMetricKeys: MetricKey[];
  isMetricSelectorOpen: boolean;
  onMetricSelectorToggle: () => void;
  onMetricVisibilityChange: (metricKey: MetricKey) => void;
  metricSelectorRef: MutableRefObject<HTMLDivElement | null>;
  allDates: string[];
  todayIso: string;
  formatDisplayDate: (iso: string) => string;
  onEditableChange: (channelKey: string, date: string, field: EditableField, rawValue: string) => void;
  onPasteValues: (
    channelKey: string,
    date: string,
    field: EditableField,
    clipboardText: string
  ) => void;
  formatNumber: (value?: number | null) => string;
  makeChannelKey: (channel: { sku_code: string; warehouse_name: string; channel: string }) => string;
  makeCellKey: (channelKey: string, date: string) => string;
  valuesEqual: (a: number | null | undefined, b: number | null | undefined) => boolean;
  selectedChannelKey: string | null;
  setSelectedChannelKey: (key: string | null) => void;
  rowGroupRefs: MutableRefObject<(HTMLTableRowElement | null)[]>;
  onRowKeyDown: (
    event: ReactKeyboardEvent<HTMLTableRowElement>,
    index: number,
    channelKey: string
  ) => void;
  tableRef: MutableRefObject<HTMLTableElement | null>;
  tableScrollContainerRef: MutableRefObject<HTMLDivElement | null>;
  headerRightScrollRef: MutableRefObject<HTMLDivElement | null>;
}

interface TableRowDefinition {
  channel: PSIEditableChannel;
  channelIndex: number;
  channelKey: string;
  metric: MetricDefinition;
  metricIndex: number;
  rowSpan: number;
  dateMap: Map<string, PSIEditableDay>;
}

const PSITableSplit = ({
  tableData,
  baselineMap,
  visibleMetrics,
  metricDefinitions,
  visibleMetricKeys,
  isMetricSelectorOpen,
  onMetricSelectorToggle,
  onMetricVisibilityChange,
  metricSelectorRef,
  allDates,
  todayIso,
  formatDisplayDate,
  onEditableChange,
  onPasteValues,
  formatNumber,
  makeChannelKey,
  makeCellKey,
  valuesEqual,
  selectedChannelKey,
  setSelectedChannelKey,
  rowGroupRefs,
  onRowKeyDown,
  tableRef,
  tableScrollContainerRef,
  headerRightScrollRef,
}: PSITableSplitProps) => {
  const leftPaneRef = useRef<HTMLDivElement | null>(null);
  const rightPaneRef = useRef<HTMLDivElement | null>(null);
  const headerRightInnerRef = useRef<HTMLDivElement | null>(null);
  const syncingRef = useRef(false);

  useEffect(() => {
    tableScrollContainerRef.current = rightPaneRef.current;
    return () => {
      if (tableScrollContainerRef.current === rightPaneRef.current) {
        tableScrollContainerRef.current = null;
      }
    };
  }, [tableScrollContainerRef]);

  useEffect(() => {
    headerRightScrollRef.current = headerRightInnerRef.current;
    return () => {
      if (headerRightScrollRef.current === headerRightInnerRef.current) {
        headerRightScrollRef.current = null;
      }
    };
  }, [headerRightScrollRef]);

  const rows = useMemo<TableRowDefinition[]>(() => {
    if (!visibleMetrics.length) {
      return [];
    }

    return tableData.flatMap((channel, channelIndex) => {
      const channelKey = makeChannelKey(channel);
      const rowSpan = visibleMetrics.length;
      const dateMap = new Map(channel.daily.map((entry) => [entry.date, entry]));

      return visibleMetrics.map((metric, metricIndex) => ({
        channel,
        channelIndex,
        channelKey,
        metric,
        metricIndex,
        rowSpan,
        dateMap,
      }));
    });
  }, [makeChannelKey, tableData, visibleMetrics]);

  const handleLeftScroll = () => {
    const left = leftPaneRef.current;
    const right = rightPaneRef.current;
    if (!left || !right) {
      return;
    }
    if (syncingRef.current) {
      return;
    }
    syncingRef.current = true;
    right.scrollTop = left.scrollTop;
    window.requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  };

  const handleRightScroll = () => {
    const left = leftPaneRef.current;
    const right = rightPaneRef.current;
    const headerRight = headerRightInnerRef.current;
    if (!right) {
      return;
    }
    if (syncingRef.current) {
      return;
    }
    syncingRef.current = true;
    if (left) {
      left.scrollTop = right.scrollTop;
    }
    if (headerRight) {
      headerRight.scrollLeft = right.scrollLeft;
    }
    window.requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  };

  const handleHeaderScroll = () => {
    const right = rightPaneRef.current;
    const headerRight = headerRightInnerRef.current;
    if (!right || !headerRight) {
      return;
    }
    if (syncingRef.current) {
      return;
    }
    syncingRef.current = true;
    right.scrollLeft = headerRight.scrollLeft;
    window.requestAnimationFrame(() => {
      syncingRef.current = false;
    });
  };

  const renderMetricSelector = () => (
    <div className="metric-header" ref={metricSelectorRef}>
      <button
        type="button"
        className="metric-toggle"
        onClick={onMetricSelectorToggle}
        aria-expanded={isMetricSelectorOpen}
      >
        div
      </button>
      {isMetricSelectorOpen && (
        <div className="metric-selector">
          <p className="metric-selector-title">表示する指標</p>
          <div className="metric-selector-options">
            {metricDefinitions.map((metric) => {
              const key = metric.key as MetricKey;
              const checked = visibleMetricKeys.includes(key);
              const disabled = checked && visibleMetricKeys.length === 1;
              return (
                <label key={metric.key}>
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={disabled}
                    onChange={() => onMetricVisibilityChange(key)}
                  />
                  {metric.label}
                </label>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="psi-grid">
      <div className="psi-header">
        <div className="psi-header-row">
          <div className="psi-header-left">
            <table className="psi-table">
              <thead>
                <tr>
                  <th className="col-sku">sku_code</th>
                  <th className="col-sku-name">sku_name</th>
                  <th className="col-warehouse">warehouse_name</th>
                  <th className="col-channel">channel</th>
                  <th className="col-div">{renderMetricSelector()}</th>
                </tr>
              </thead>
            </table>
          </div>
          <div className="psi-header-right">
            <div
              className="psi-header-right-scroll"
              ref={headerRightInnerRef}
              onScroll={handleHeaderScroll}
              role="presentation"
            >
              <table className="psi-table" ref={tableRef}>
                <thead>
                  <tr>
                    {allDates.map((date) => (
                      <th
                        key={date}
                        className={`date-header${date === todayIso ? " today-column" : ""}`}
                        data-date={date}
                      >
                        {formatDisplayDate(date)}
                      </th>
                    ))}
                  </tr>
                </thead>
              </table>
            </div>
          </div>
        </div>
      </div>
      <div className="psi-body">
        <div className="psi-left-pane" ref={leftPaneRef} onScroll={handleLeftScroll}>
          <table className="psi-table">
            <tbody>
              {rows.map(({
                channel,
                channelIndex,
                channelKey,
                metric,
                metricIndex,
                rowSpan,
              }) => {
                const isFirstMetricRow = metricIndex === 0;
                const isSelected = selectedChannelKey === channelKey;

                return (
                  <tr
                    key={`left-${channelKey}-${metric.key}`}
                    className={`psi-table-row${isSelected ? " selected" : ""}`}
                    onClick={() => setSelectedChannelKey(channelKey)}
                    tabIndex={isFirstMetricRow ? 0 : -1}
                    ref={
                      isFirstMetricRow
                        ? (element) => {
                            rowGroupRefs.current[channelIndex] = element ?? null;
                          }
                        : undefined
                    }
                    onKeyDown={
                      isFirstMetricRow
                        ? (event) => onRowKeyDown(event, channelIndex, channelKey)
                        : undefined
                    }
                    aria-selected={isSelected}
                  >
                    {isFirstMetricRow && (
                      <>
                        <td className={`col-sku${isSelected ? " selected" : ""}`} rowSpan={rowSpan}>
                          {channel.sku_code}
                        </td>
                        <td className={`col-sku-name${isSelected ? " selected" : ""}`} rowSpan={rowSpan}>
                          {channel.sku_name ?? "—"}
                        </td>
                        <td className={`col-warehouse${isSelected ? " selected" : ""}`} rowSpan={rowSpan}>
                          {channel.warehouse_name}
                        </td>
                        <td className={`col-channel${isSelected ? " selected" : ""}`} rowSpan={rowSpan}>
                          {channel.channel}
                        </td>
                      </>
                    )}
                    <td className={`col-div psi-metric-name${isSelected ? " selected" : ""}`}>
                      {metric.label}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="psi-right-pane" ref={rightPaneRef} onScroll={handleRightScroll}>
          <table className="psi-table">
            <tbody>
              {rows.map(({ channelKey, metric, dateMap }) => {
                const isSelected = selectedChannelKey === channelKey;

                return (
                  <tr
                    key={`right-${channelKey}-${metric.key}`}
                    className={`psi-table-row${isSelected ? " selected" : ""}`}
                    onClick={() => setSelectedChannelKey(channelKey)}
                    tabIndex={-1}
                    aria-selected={isSelected}
                  >
                    {allDates.map((date) => {
                      const entry = dateMap.get(date);
                      const cellKey = `${channelKey}-${metric.key}-${date}`;
                      const todayClass = date === todayIso ? " today-column" : "";

                      if (!entry) {
                        return (
                          <td key={cellKey} className={`numeric${todayClass}`}>
                            —
                          </td>
                        );
                      }

                      const value = entry[metric.key];

                      if (isEditableMetric(metric)) {
                        const baselineEntry = baselineMap.get(makeCellKey(channelKey, date));
                        const baselineValue = baselineEntry ? baselineEntry[metric.key] ?? null : null;
                        const currentValue = value ?? null;
                        const isEdited = !valuesEqual(currentValue, baselineValue);

                        return (
                          <td key={cellKey} className={`numeric${todayClass}`}>
                            <input
                              type="text"
                              className={`psi-edit-input${isEdited ? " edited" : ""}`}
                              value={currentValue ?? ""}
                              onChange={(event) =>
                                onEditableChange(channelKey, date, metric.key, event.target.value)
                              }
                              inputMode="decimal"
                              onPaste={(event) => {
                                event.preventDefault();
                                onPasteValues(
                                  channelKey,
                                  date,
                                  metric.key,
                                  event.clipboardData.getData("text")
                                );
                              }}
                            />
                          </td>
                        );
                      }

                      return (
                        <td key={cellKey} className={`numeric${todayClass}`}>
                          {formatNumber(value)}
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
    </div>
  );
};

export default PSITableSplit;
