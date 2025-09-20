import { MutableRefObject } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";

import iconUrls from "../lib/iconUrls.json";
import { EditableField, MetricDefinition, MetricKey, PSIEditableChannel, PSIEditableDay } from "../pages/psiTableTypes";
import PSITableSplit from "./PSITableSplit";

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
  tableRef: MutableRefObject<HTMLTableElement | null>;
  tableScrollContainerRef: MutableRefObject<HTMLDivElement | null>;
  topScrollContainerRef: MutableRefObject<HTMLDivElement | null>;
  tableScrollAreaRef: MutableRefObject<HTMLDivElement | null>;
  onDownload: () => void;
  canDownload: boolean;
  selectedChannelKey: string | null;
  setSelectedChannelKey: (key: string | null) => void;
  onClearSelection: () => void;
  applyError: string | null;
  applySuccess: string | null;
  baselineMap: Map<string, PSIEditableDay>;
  onEditableChange: (channelKey: string, date: string, field: EditableField, rawValue: string) => void;
  onPasteValues: (channelKey: string, date: string, field: EditableField, clipboardText: string) => void;
  formatNumber: (value?: number | null) => string;
  makeChannelKey: (channel: { sku_code: string; warehouse_name: string; channel: string }) => string;
  makeCellKey: (channelKey: string, date: string) => string;
  valuesEqual: (a: number | null | undefined, b: number | null | undefined) => boolean;
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
  tableRef,
  tableScrollContainerRef,
  topScrollContainerRef,
  tableScrollAreaRef,
  onDownload,
  canDownload,
  selectedChannelKey,
  setSelectedChannelKey,
  onClearSelection,
  applyError,
  applySuccess,
  baselineMap,
  onEditableChange,
  onPasteValues,
  formatNumber,
  makeChannelKey,
  makeCellKey,
  valuesEqual,
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
            <PSITableSplit
              tableData={tableData}
              baselineMap={baselineMap}
              visibleMetrics={visibleMetrics}
              metricDefinitions={metricDefinitions}
              visibleMetricKeys={visibleMetricKeys}
              isMetricSelectorOpen={isMetricSelectorOpen}
              onMetricSelectorToggle={onMetricSelectorToggle}
              onMetricVisibilityChange={onMetricVisibilityChange}
              metricSelectorRef={metricSelectorRef}
              allDates={allDates}
              todayIso={todayIso}
              formatDisplayDate={formatDisplayDate}
              onEditableChange={onEditableChange}
              onPasteValues={onPasteValues}
              formatNumber={formatNumber}
              makeChannelKey={makeChannelKey}
              makeCellKey={makeCellKey}
              valuesEqual={valuesEqual}
              selectedChannelKey={selectedChannelKey}
              setSelectedChannelKey={setSelectedChannelKey}
              rowGroupRefs={rowGroupRefs}
              onRowKeyDown={onRowKeyDown}
              tableRef={tableRef}
              tableScrollContainerRef={tableScrollContainerRef}
              headerRightScrollRef={topScrollContainerRef}
            />
          </div>
        </div>
      ) : (
        sessionId && !isLoading && <p className="psi-table-status">No PSI data for the current filters.</p>
      )}
    </section>
  );
};

export default PSITableContent;
