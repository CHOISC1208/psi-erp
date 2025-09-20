import { ForwardedRef, forwardRef } from "react";
import { UseQueryResult } from "@tanstack/react-query";

import iconUrls from "../lib/iconUrls.json";
import { PSISessionSummary, Session } from "../types";

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
  onTodayClick: () => void;
  hasBaselineData: boolean;
  getErrorMessage: (error: unknown, fallback: string) => string;
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
    onTodayClick,
    hasBaselineData,
    getErrorMessage,
  }: PSITableControlsProps,
  ref: ForwardedRef<HTMLElement>
) {
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
          <div className="psi-panel psi-filter-panel">
            <h3>フィルタ</h3>
            <div className="psi-filter-grid">
              <label>
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
              <label>
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
            {sessionsQuery.isLoading && <p>Loading sessions...</p>}
            {sessionsQuery.isError && (
              <p className="error">{getErrorMessage(sessionsQuery.error, "Unable to load sessions.")}</p>
            )}
          </div>
          <div className="psi-panel psi-description-panel">
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
                <label>
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
        <button type="button" className="psi-button today" onClick={onTodayClick} aria-label="今日の列へ移動">
          <img src={iconUrls.today} alt="" aria-hidden="true" className="psi-button-icon" />
          <span>今日へ</span>
        </button>
      </div>
    </section>
  );
});

export default PSITableControls;
