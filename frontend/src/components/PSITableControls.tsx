import { ForwardedRef, forwardRef } from "react";
import { UseQueryResult } from "@tanstack/react-query";

import iconUrls from "../lib/iconUrls.json";
import { PSISessionSummary, Session } from "../types";
import PSIDescriptionPanel from "./PSIDescriptionPanel";
import PSIFilterPanel from "./PSIFilterPanel";

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
          <PSIFilterPanel
            sessionId={sessionId}
            availableSessions={availableSessions}
            onSessionChange={onSessionChange}
            sessionsQuery={sessionsQuery}
            skuCode={skuCode}
            onSkuCodeChange={onSkuCodeChange}
            warehouseName={warehouseName}
            onWarehouseNameChange={onWarehouseNameChange}
            channel={channel}
            onChannelChange={onChannelChange}
            getErrorMessage={getErrorMessage}
          />
          <PSIDescriptionPanel
            sessionId={sessionId}
            sessionSummaryQuery={sessionSummaryQuery}
            formattedStart={formattedStart}
            formattedEnd={formattedEnd}
            formattedCreatedAt={formattedCreatedAt}
            formattedUpdatedAt={formattedUpdatedAt}
            descriptionDraft={descriptionDraft}
            onDescriptionChange={onDescriptionChange}
            onDescriptionSave={onDescriptionSave}
            isDescriptionDirty={isDescriptionDirty}
            isSavingDescription={isSavingDescription}
            descriptionError={descriptionError}
            descriptionSaved={descriptionSaved}
            getErrorMessage={getErrorMessage}
          />
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
