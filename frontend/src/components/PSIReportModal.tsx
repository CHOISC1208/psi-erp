import { MouseEvent, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

import { PSIReportSettings } from "../types";

interface PSIReportModalProps {
  isOpen: boolean;
  skuCode: string | null;
  skuName: string | null;
  report: string | null;
  generatedAt: string | null;
  settings: PSIReportSettings | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onRetry?: () => void;
}

const formatDateTime = (iso: string | null) => {
  if (!iso) {
    return "—";
  }
  try {
    const date = new Date(iso);
    return new Intl.DateTimeFormat("ja-JP", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch (error) {
    return iso;
  }
};

const PSIReportModal = ({
  isOpen,
  skuCode,
  skuName,
  report,
  generatedAt,
  settings,
  isLoading,
  error,
  onClose,
  onRetry,
}: PSIReportModalProps) => {
  const headingId = useId();
  const descriptionId = useId();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    closeButtonRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  if (typeof document === "undefined") {
    return null;
  }

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget) {
      onClose();
    }
  };

  const handleCopy = async () => {
    if (!report || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(report);
    } catch (copyError) {
      console.error("Failed to copy report", copyError);
    }
  };

  return createPortal(
    <div className="psi-report-modal-backdrop" role="presentation" onMouseDown={handleBackdropClick}>
      <div className="psi-report-modal" role="dialog" aria-modal="true" aria-labelledby={headingId} aria-describedby={descriptionId}>
        <header className="psi-report-modal__header">
          <div>
            <h2 id={headingId}>在庫移動レポート</h2>
            <p id={descriptionId} className="psi-report-modal__subtitle">
              SKU: {skuCode ?? "—"}
              {skuName ? ` / ${skuName}` : ""}
            </p>
          </div>
          <div className="psi-report-modal__header-actions">
            <button type="button" className="psi-button secondary" onClick={handleCopy} disabled={!report}>
              コピー
            </button>
            {onRetry && (
              <button type="button" className="psi-button secondary" onClick={onRetry} disabled={isLoading}>
                再生成
              </button>
            )}
            <button type="button" className="psi-button" onClick={onClose} ref={closeButtonRef}>
              閉じる
            </button>
          </div>
        </header>
        <div className="psi-report-modal__meta">
          <div>
            <span className="psi-report-modal__meta-label">生成日時</span>
            <span className="psi-report-modal__meta-value">{formatDateTime(generatedAt)}</span>
          </div>
          {settings && (
            <div>
              <span className="psi-report-modal__meta-label">設定</span>
              <span className="psi-report-modal__meta-value">
                LT {settings.lead_time_days}日 / 安全在庫 {settings.safety_buffer_days}日 / 最小移動 {settings.min_move_qty} / 先読み {settings.target_days_ahead}日
              </span>
            </div>
          )}
          {settings?.priority_channels && settings.priority_channels.length > 0 && (
            <div>
              <span className="psi-report-modal__meta-label">優先チャネル</span>
              <span className="psi-report-modal__meta-value">{settings.priority_channels.join(", ")}</span>
            </div>
          )}
        </div>
        <div className="psi-report-modal__body">
          {isLoading && <p className="psi-report-modal__status">レポートを生成しています…</p>}
          {error && !isLoading && <p className="psi-report-modal__status error">{error}</p>}
          {!isLoading && !error && report && (
            <pre className="psi-report-modal__content" aria-live="polite">
              {report}
            </pre>
          )}
          {!isLoading && !error && !report && <p className="psi-report-modal__status">表示するレポートがありません。</p>}
        </div>
      </div>
    </div>,
    document.body
  );
};

export default PSIReportModal;
