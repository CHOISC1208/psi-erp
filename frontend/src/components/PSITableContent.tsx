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
import PSITable from "./PSITable";

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
          <PSITable
            tableData={tableData}
            visibleMetrics={visibleMetrics}
            allDates={allDates}
            todayIso={todayIso}
            formatDisplayDate={formatDisplayDate}
            metricHeader={
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
            }
            tableContentWidth={tableContentWidth}
            tableRef={tableRef}
            tableScrollContainerRef={tableScrollContainerRef}
            topScrollContainerRef={topScrollContainerRef}
            tableScrollAreaRef={tableScrollAreaRef}
            onTopScroll={onTopScroll}
            onBottomScroll={onBottomScroll}
            baselineMap={baselineMap}
            onEditableChange={onEditableChange}
            onPasteValues={onPasteValues}
            formatNumber={formatNumber}
            isEditableMetric={isEditableMetric}
            makeChannelKey={makeChannelKey}
            makeCellKey={makeCellKey}
            valuesEqual={valuesEqual}
            selectedChannelKey={selectedChannelKey}
            onRowSelection={onRowSelection}
            rowGroupRefs={rowGroupRefs}
            onRowKeyDown={onRowKeyDown}
          />
        </div>
      ) : (
        sessionId && !isLoading && <p className="psi-table-status">No PSI data for the current filters.</p>
      )}
    </section>
  );
};

export default PSITableContent;
