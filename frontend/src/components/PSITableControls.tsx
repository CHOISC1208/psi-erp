import { ForwardedRef, forwardRef, useEffect, useMemo, useState } from "react";
import { UseQueryResult } from "@tanstack/react-query";

import iconUrls from "../lib/iconUrls.json";
import { PSIChannel, PSISessionSummary, Session } from "../types";
import PSISummaryTable from "./PSISummaryTable";
import { buildSummary } from "../utils/psiSummary";

interface PSITableControlsProps {
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  sessionId: string;
  availableSessions: Session[];
  onSessionChange: (value: string) => void;
  sessionsQuery: UseQueryResult<Session[], unknown>;
  skuCode: string;
  onSkuCodeChange: (value: string) => void;
  warehouseName: string;
  onWarehouseNameChange: (value: string) => void;
  channel: string;
  onChannelChange: (value: string) => void;
  psiData: PSIChannel[] | undefined;
  sessionSummaryQuery: UseQueryResult<PSISessionSummary, unknown>;
  formattedStart: string;
  formattedEnd: string;
  formattedCreatedAt: string;
  formattedUpdatedAt: string;
  descriptionDraft: string;
  onDescriptionChange: (value: string) => void;
  onDescriptionSave: () => void;
  isDescriptionDirty: boolean;
  isSavingDescription: boolean;
  descriptionError: string | null;
  descriptionSaved: boolean;
  onApply: () => void;
  canApply: boolean;
  isApplying: boolean;
  onRefresh: () => void;
  refreshDisabled: boolean;
  onReset: () => void;
  hasBaselineData: boolean;
  getErrorMessage: (error: unknown, fallback: string) => string;
  selectedSku: string | null;
  onSelectSku: (sku: string | null) => void;
}

const PSITableControls = forwardRef(function PSITableControls(
  {
    isCollapsed,
    onToggleCollapse,
    sessionId,
    availableSessions,
    onSessionChange,
    sessionsQuery,
    skuCode,
    onSkuCodeChange,
    warehouseName,
    onWarehouseNameChange,
    channel,
    onChannelChange,
    psiData,
    sessionSummaryQuery,
    formattedStart,
    formattedEnd,
    formattedCreatedAt,
    formattedUpdatedAt,
    descriptionDraft,
    onDescriptionChange,
    onDescriptionSave,
    isDescriptionDirty,
    isSavingDescription,
    descriptionError,
    descriptionSaved,
    onApply,
    canApply,
    isApplying,
    onRefresh,
    refreshDisabled,
    onReset,
    hasBaselineData,
    getErrorMessage,
    selectedSku,
    onSelectSku,
  }: PSITableControlsProps,
  ref: ForwardedRef<HTMLElement>
) {
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 3;

  const start = sessionSummaryQuery.data?.start_date ?? undefined;
  const end = sessionSummaryQuery.data?.end_date ?? undefined;

  const summaryAll = useMemo(
    () => buildSummary(psiData ?? [], start, end),
    [psiData, start, end]
  );

  const sorted = useMemo(
    () => [...summaryAll].sort((a, b) => a.sku_code.localeCompare(b.sku_code)),
    [summaryAll]
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const startIndex = (page - 1) * pageSize;
  const pageRows = useMemo(() => sorted.slice(startIndex, startIndex + pageSize), [sorted, startIndex]);

  useEffect(() => {
    setCurrentPage(1);
  }, [sessionId, skuCode, warehouseName, channel]);

  useEffect(() => {
    if (!selectedSku) {
      return;
    }
    const visible = new Set(pageRows.map((row) => row.sku_code));
    if (!visible.has(selectedSku)) {
      onSelectSku(null);
    }
  }, [pageRows, selectedSku, onSelectSku]);

  const goPrev = () => setCurrentPage((previous) => Math.max(1, previous - 1));
  const goNext = () => setCurrentPage((previous) => Math.min(totalPages, previous + 1));

  return (
    <section ref={ref} className={`psi-controls${isCollapsed ? " collapsed" : ""}`}>
      <div className="psi-controls-header">
        <h2>Filters &amp; Description</h2>
        <button type="button" className="collapse-toggle" onClick={onToggleCollapse}>
          {isCollapsed ? "詳細を表示" : "詳細を折りたたむ"}
        </button>
      </div>
      {!isCollapsed && (
        <div className="psi-controls-body">
          <section className="psi-left-pane">
            <div className="psi-panel psi-filter-panel row-full">
              <h3>フィルタ</h3>
              <div className="psi-filter-grid">
                <label className="row-full">
                  Session
                  <select
                    value={sessionId}
                    onChange={(event) => onSessionChange(event.target.value)}
                    disabled={sessionsQuery.isLoading}
                  >
                    <option value="" disabled>
                      Select a session
                    </option>
                    {availableSessions.map((session) => (
                      <option key={session.id} value={session.id}>
                        {session.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="row-full">
                  SKU Code
                  <input
                    type="text"
                    value={skuCode}
                    onChange={(event) => onSkuCodeChange(event.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <label>
                  Warehouse
                  <input
                    type="text"
                    value={warehouseName}
                    onChange={(event) => onWarehouseNameChange(event.target.value)}
                    placeholder="Optional"
                  />
                </label>
                <label>
                  Channel
                  <input
                    type="text"
                    value={channel}
                    onChange={(event) => onChannelChange(event.target.value)}
                    placeholder="Optional"
                  />
                </label>
              </div>
              {sessionsQuery.isLoading && <p className="row-full">Loading sessions...</p>}
              {sessionsQuery.isError && (
                <p className="error row-full">{getErrorMessage(sessionsQuery.error, "Unable to load sessions.")}</p>
              )}
            </div>
            <div className="psi-panel psi-description-panel row-full">
              {sessionId ? (
                <>
                  <div className="psi-description-dates">
                    <div>
                      <strong>開始日</strong>
                      <span>{sessionSummaryQuery.isLoading ? "…" : formattedStart}</span>
                    </div>
                    <div>
                      <strong>終了日</strong>
                      <span>{sessionSummaryQuery.isLoading ? "…" : formattedEnd}</span>
                    </div>
                  </div>
                  {sessionSummaryQuery.isError && (
                    <p className="error">
                      {getErrorMessage(sessionSummaryQuery.error, "Unable to load session date range.")}
                    </p>
                  )}
                  <label className="row-full">
                    Description
                    <textarea
                      value={descriptionDraft}
                      onChange={(event) => onDescriptionChange(event.target.value)}
                      placeholder="Add a description for this session"
                    />
                  </label>
                  <div className="session-summary-actions">
                    <button
                      type="button"
                      className="psi-button secondary"
                      onClick={onDescriptionSave}
                      disabled={!isDescriptionDirty || isSavingDescription}
                      aria-label={isSavingDescription ? "説明を保存中" : "説明を保存"}
                    >
                      <img src={iconUrls.save} alt="" aria-hidden="true" className="psi-button-icon" />
                      <span>{isSavingDescription ? "保存中…" : "保存"}</span>
                    </button>
                    {descriptionError && <span className="error">{descriptionError}</span>}
                    {descriptionSaved && <span className="success">Description updated.</span>}
                  </div>
                  <div className="psi-session-meta">
                    <div>
                      <strong>作成日</strong>
                      <span>{formattedCreatedAt}</span>
                    </div>
                    <div>
                      <strong>更新日</strong>
                      <span>{formattedUpdatedAt}</span>
                    </div>
                  </div>
                </>
              ) : (
                <p>Select a session to view its details.</p>
              )}
            </div>
          </section>
          <aside className="psi-right-pane">
            <div className="psi-summary-card">
              {sorted.length > 0 ? (
                <PSISummaryTable
                  rows={pageRows}
                  onSelectSku={onSelectSku}
                  selectedSku={selectedSku}
                  channelOrder={["online", "retail", "wholesale"]}
                />
              ) : (
                <p className="psi-summary-empty">該当する集計データがありません。</p>
              )}
            </div>
          </aside>
        </div>
      )}
      <div className="psi-toolbar" role="toolbar" aria-label="PSI data actions">
        <div className="psi-toolbar-group">
          <button
            type="button"
            className="psi-button primary"
            onClick={onApply}
            disabled={!canApply || isApplying}
          >
            <img src={iconUrls.apply} alt="" aria-hidden="true" className="psi-button-icon" />
            <span>{isApplying ? "Applying…" : "適用"}</span>
          </button>
        </div>
        <div className="psi-toolbar-group">
          <button
            type="button"
            className="psi-button secondary"
            onClick={onRefresh}
            disabled={refreshDisabled}
          >
            <img src={iconUrls.refresh} alt="" aria-hidden="true" className="psi-button-icon" />
            <span>更新</span>
          </button>
          <button
            type="button"
            className="psi-button secondary"
            onClick={onReset}
            disabled={!hasBaselineData}
          >
            <img src={iconUrls.reset} alt="" aria-hidden="true" className="psi-button-icon" />
            <span>リセット</span>
          </button>
        </div>
        <div className="psi-toolbar-spacer" aria-hidden="true" />
        <div className="psi-toolbar-group psi-toolbar-pager">
          <button type="button" onClick={goPrev} disabled={page <= 1 || sorted.length === 0}>
            ‹ 前へ
          </button>
          <span>{sorted.length === 0 ? "0 / 0" : `${page} / ${totalPages}`}</span>
          <button type="button" onClick={goNext} disabled={page >= totalPages || sorted.length === 0}>
            次へ ›
          </button>
        </div>
      </div>
    </section>
  );
});

export default PSITableControls;
