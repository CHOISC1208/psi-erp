import {
  ForwardedRef,
  forwardRef,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { UseQueryResult } from "@tanstack/react-query";

import iconUrls from "../lib/iconUrls.json";
import { PSIChannel, PSISessionSummary, Session } from "../types";
import PSISummaryTable from "./PSISummaryTable";
import { buildSummary } from "../utils/psiSummary";
import {
  SummaryFilterDefinition,
  applySummaryFilters,
  resolveSummaryFilter,
  summaryFilters,
} from "../utils/psiSummaryFilters";

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
  const [activeFilters, setActiveFilters] = useState<string[]>([]);
  const [isFilterMenuOpen, setIsFilterMenuOpen] = useState(false);
  const pageSize = 4;
  const filterButtonId = useId();
  const filterLabelId = `${filterButtonId}-label`;
  const filterHintId = `${filterButtonId}-hint`;
  const filterDropdownRef = useRef<HTMLDivElement | null>(null);
  const filterButtonRef = useRef<HTMLButtonElement | null>(null);
  const firstFilterInputRef = useRef<HTMLInputElement | null>(null);
  const previousFiltersRef = useRef<string[]>([]);

  const start = sessionSummaryQuery.data?.start_date ?? undefined;
  const end = sessionSummaryQuery.data?.end_date ?? undefined;

  const summaryAll = useMemo(
    () => buildSummary(psiData ?? [], start, end),
    [psiData, start, end]
  );

  const filtered = useMemo(
    () => applySummaryFilters(summaryAll, activeFilters),
    [summaryAll, activeFilters]
  );

  const sorted = useMemo(
    () => [...filtered].sort((a, b) => a.sku_code.localeCompare(b.sku_code)),
    [filtered]
  );

  const totalPages = Math.max(1, Math.ceil(sorted.length / pageSize));
  const page = Math.min(currentPage, totalPages);
  const startIndex = (page - 1) * pageSize;
  const pageRows = useMemo(() => sorted.slice(startIndex, startIndex + pageSize), [sorted, startIndex]);

  const selectedFilterDetails = useMemo(
    () =>
      activeFilters
        .map((id) => resolveSummaryFilter(id))
        .filter((filter): filter is SummaryFilterDefinition => Boolean(filter)),
    [activeFilters]
  );

  const handleFilterToggle = (filterId: string) => {
    setActiveFilters((previous) => {
      if (previous.includes(filterId)) {
        return previous.filter((id) => id !== filterId);
      }

      const withNew = [...previous, filterId];
      const ordered = summaryFilters
        .map((filter) => filter.id)
        .filter((id) => withNew.includes(id));

      return ordered;
    });
  };

  const handleClearFilters = () => {
    setActiveFilters([]);
    setIsFilterMenuOpen(false);
    filterButtonRef.current?.focus();
  };

  const handleFilterMenuToggle = () => {
    setIsFilterMenuOpen((previous) => !previous);
  };

  useEffect(() => {
    if (!isFilterMenuOpen) {
      return;
    }

    const handlePointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) {
        return;
      }
      if (filterDropdownRef.current?.contains(target)) {
        return;
      }
      setIsFilterMenuOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        setIsFilterMenuOpen(false);
        filterButtonRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isFilterMenuOpen]);

  useEffect(() => {
    if (isFilterMenuOpen) {
      firstFilterInputRef.current?.focus({ preventScroll: true });
    }
  }, [isFilterMenuOpen]);

  useEffect(() => {
    setCurrentPage(1);
  }, [sessionId, skuCode, warehouseName, channel, activeFilters]);

  useEffect(() => {
    const previous = previousFiltersRef.current;
    const filtersChanged =
      previous.length !== activeFilters.length ||
      previous.some((value, index) => value !== activeFilters[index]);

    if (filtersChanged && selectedSku) {
      onSelectSku(null);
    }

    previousFiltersRef.current = activeFilters;
  }, [activeFilters, onSelectSku, selectedSku]);

  useEffect(() => {
    if (!selectedSku) {
      return;
    }
    const visible = new Set(pageRows.map((row) => row.sku_code));
    if (!visible.has(selectedSku)) {
      onSelectSku(null);
    }
  }, [pageRows, selectedSku, onSelectSku, activeFilters]);

  const goPrev = () => setCurrentPage((previous) => Math.max(1, previous - 1));
  const goNext = () => setCurrentPage((previous) => Math.min(totalPages, previous + 1));

  const filterSummaryLabel =
    selectedFilterDetails.length === 0
      ? "フィルタを選択"
      : `選択中: ${selectedFilterDetails.map((filter) => filter.label).join(", ")}`;

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
              <div className="psi-summary-header">
                <div className="psi-summary-title">
                  <h3>SKU集計</h3>
                  <p className="psi-summary-subtitle">選択中のセッションに含まれるSKUを確認できます。</p>
                </div>
                <div className="psi-summary-filter-controls">
                  <div className="psi-summary-filter-label">
                    <span id={filterLabelId}>集計フィルタ</span>
                    <div className="psi-summary-filter-dropdown" ref={filterDropdownRef}>
                      <button
                        type="button"
                        id={filterButtonId}
                        ref={filterButtonRef}
                        className="psi-summary-filter-trigger"
                        aria-haspopup="true"
                        aria-expanded={isFilterMenuOpen}
                        aria-labelledby={`${filterLabelId} ${filterButtonId}`}
                        aria-describedby={selectedFilterDetails.length === 0 ? filterHintId : undefined}
                        onClick={handleFilterMenuToggle}
                      >
                        <span className="psi-summary-filter-trigger-label">{filterSummaryLabel}</span>
                        <span className="psi-summary-filter-trigger-icon" aria-hidden="true">
                          ▾
                        </span>
                      </button>
                      {isFilterMenuOpen && (
                        <div className="psi-summary-filter-menu" role="group" aria-labelledby={filterLabelId}>
                          {summaryFilters.map((filter, index) => {
                            const checked = activeFilters.includes(filter.id);
                            return (
                              <label key={filter.id} className="psi-summary-filter-option">
                                <input
                                  ref={index === 0 ? firstFilterInputRef : undefined}
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => handleFilterToggle(filter.id)}
                                />
                                <span className="psi-summary-filter-option-text">
                                  <span className="psi-summary-filter-option-label">{filter.label}</span>
                                  <span className="psi-summary-filter-option-description">{filter.description}</span>
                                </span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </div>
                  {selectedFilterDetails.length > 0 ? (
                    <div className="psi-summary-filter-tokens" role="list">
                      {selectedFilterDetails.map((filter) => (
                        <span key={filter.id} className="psi-summary-filter-token" role="listitem" title={filter.description}>
                          {filter.label}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p id={filterHintId} className="psi-summary-filter-hint">
                      フィルタを選択すると条件に合うSKUだけを表示できます。
                      ボタンをクリックしてチェックボックスを選択してください。
                    </p>
                  )}
                  {selectedFilterDetails.length > 0 && (
                    <button
                      type="button"
                      className="psi-button secondary psi-summary-clear-filters"
                      onClick={handleClearFilters}
                    >
                      フィルタをクリア
                    </button>
                  )}
                </div>
              </div>
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
