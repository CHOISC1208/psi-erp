import { MutableRefObject } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, UIEvent as ReactUIEvent } from "react";

import iconUrls from "../lib/iconUrls.json";
import {
  EditableField,
  EditableMetricDefinition,
  MetricDefinition,
  MetricKey,
  PSIEditableChannel,
  PSIEditableDay,
} from "../pages/psiTableTypes";

interface PSITableContentProps {
  sessionId: string;
  isLoading: boolean;
  isError: boolean;
  errorMessage: string | null;
  tableData: PSIEditableChannel[];
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
  tableContentWidth: number;
  tableRef: MutableRefObject<HTMLTableElement | null>;
  tableScrollContainerRef: MutableRefObject<HTMLDivElement | null>;
  topScrollContainerRef: MutableRefObject<HTMLDivElement | null>;
  tableScrollAreaRef: MutableRefObject<HTMLDivElement | null>;
  onTopScroll: (event: ReactUIEvent<HTMLDivElement>) => void;
  onBottomScroll: (event: ReactUIEvent<HTMLDivElement>) => void;
  onDownload: () => void;
  canDownload: boolean;
  selectedChannelKey: string | null;
  onClearSelection: () => void;
  applyError: string | null;
  applySuccess: string | null;
  baselineMap: Map<string, PSIEditableDay>;
  onEditableChange: (channelKey: string, date: string, field: EditableField, rawValue: string) => void;
  onPasteValues: (channelKey: string, date: string, field: EditableField, clipboardText: string) => void;
  formatNumber: (value?: number | null) => string;
  isEditableMetric: (metric: MetricDefinition) => metric is EditableMetricDefinition;
  makeChannelKey: (channel: { sku_code: string; warehouse_name: string; channel: string }) => string;
  makeCellKey: (channelKey: string, date: string) => string;
  valuesEqual: (a: number | null | undefined, b: number | null | undefined) => boolean;
  onRowSelection: (channelKey: string) => void;
  rowGroupRefs: MutableRefObject<(HTMLTableRowElement | null)[]>;
  onRowKeyDown: (event: ReactKeyboardEvent<HTMLTableRowElement>, index: number, channelKey: string) => void;
}

const PSITableContent = ({
  sessionId,
  isLoading,
  isError,
  errorMessage,
  tableData,
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
  tableContentWidth,
  tableRef,
  tableScrollContainerRef,
  topScrollContainerRef,
  tableScrollAreaRef,
  onTopScroll,
  onBottomScroll,
  onDownload,
  canDownload,
  selectedChannelKey,
  onClearSelection,
  applyError,
  applySuccess,
  baselineMap,
  onEditableChange,
  onPasteValues,
  formatNumber,
  isEditableMetric,
  makeChannelKey,
  makeCellKey,
  valuesEqual,
  onRowSelection,
  rowGroupRefs,
  onRowKeyDown,
}: PSITableContentProps) => {
  return (
    <section className="psi-table-section">
      {isLoading && sessionId && <p className="psi-table-status">Loading PSI data...</p>}
      {isError && <p className="psi-table-status error">{errorMessage}</p>}
      {tableData.length > 0 ? (
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
                <img src={iconUrls.downloadCsv} alt="" aria-hidden="true" className="psi-button-icon" />
                <span>CSV</span>
              </button>
              {selectedChannelKey && (
                <button
                  type="button"
                  className="psi-button secondary"
                  onClick={onClearSelection}
                  aria-label="選択を解除"
                >
                  <img src={iconUrls.clear} alt="" aria-hidden="true" className="psi-button-icon" />
                  <span>選択解除</span>
                </button>
              )}
            </div>
            {(applyError || applySuccess) && (
              <div className="psi-table-messages">
                {applyError && <span className="error">{applyError}</span>}
                {applySuccess && <span className="success">{applySuccess}</span>}
              </div>
            )}
          </div>
          <div className="psi-table-scroll-area" ref={tableScrollAreaRef}>
            <div
              className="psi-scrollbar psi-scrollbar-top"
              ref={topScrollContainerRef}
              onScroll={onTopScroll}
              role="presentation"
            >
              <div className="psi-scrollbar-filler" style={{ width: `${tableContentWidth}px` }} />
            </div>
            <div className="psi-table-container" ref={tableScrollContainerRef} onScroll={onBottomScroll}>
              <table className="psi-table" ref={tableRef}>
                <thead>
                  <tr>
                    <th className="sticky-col col-sku">sku_code</th>
                    <th className="sticky-col col-sku-name">sku_name</th>
                    <th className="sticky-col col-warehouse">warehouse_name</th>
                    <th className="sticky-col col-channel">channel</th>
                    <th className="sticky-col col-div">
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
                    </th>
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
                <tbody>
                  {tableData.map((item, channelIndex) => {
                    const channelKey = makeChannelKey(item);
                    const rowSpan = Math.max(visibleMetrics.length, 1);
                    const dateMap = new Map(item.daily.map((entry) => [entry.date, entry]));

                    if (!visibleMetrics.length) {
                      return null;
                    }

                    const isSelected = selectedChannelKey === channelKey;

                    return visibleMetrics.map((metric, metricIndex) => {
                      const isFirstMetricRow = metricIndex === 0;

                      return (
                        <tr
                          key={`${channelKey}-${metric.key}`}
                          className={`psi-table-row${isSelected ? " selected" : ""}`}
                          onClick={() => onRowSelection(channelKey)}
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
                              <td className={`sticky-col col-sku${isSelected ? " selected" : ""}`} rowSpan={rowSpan}>
                                {item.sku_code}
                              </td>
                              <td
                                className={`sticky-col col-sku-name${isSelected ? " selected" : ""}`}
                                rowSpan={rowSpan}
                              >
                                {item.sku_name ?? "—"}
                              </td>
                              <td
                                className={`sticky-col col-warehouse${isSelected ? " selected" : ""}`}
                                rowSpan={rowSpan}
                              >
                                {item.warehouse_name}
                              </td>
                              <td
                                className={`sticky-col col-channel${isSelected ? " selected" : ""}`}
                                rowSpan={rowSpan}
                              >
                                {item.channel}
                              </td>
                            </>
                          )}
                          <td className={`sticky-col col-div psi-metric-name${isSelected ? " selected" : ""}`}>
                            {metric.label}
                          </td>
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
                                      onPasteValues(channelKey, date, metric.key, event.clipboardData.getData("text"));
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
                    });
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      ) : (
        sessionId && !isLoading && <p className="psi-table-status">No PSI data for the current filters.</p>
      )}
    </section>
  );
};

export default PSITableContent;
