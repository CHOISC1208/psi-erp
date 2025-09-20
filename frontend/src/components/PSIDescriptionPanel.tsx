import { UseQueryResult } from "@tanstack/react-query";

import iconUrls from "../lib/iconUrls.json";
import { PSISessionSummary } from "../types";

interface PSIDescriptionPanelProps {
  sessionId: string;
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
  getErrorMessage: (error: unknown, fallback: string) => string;
}

function PSIDescriptionPanel({
  sessionId,
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
  getErrorMessage,
}: PSIDescriptionPanelProps) {
  return (
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
  );
}

export default PSIDescriptionPanel;
