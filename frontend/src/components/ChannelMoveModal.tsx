import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { ChannelTransfer, ChannelTransferCreate } from "../types";
import { api } from "../lib/api";

interface ChannelMoveModalProps {
  isOpen: boolean;
  sessionId: string;
  channel:
    | {
        sku_code: string;
        sku_name: string | null;
        warehouse_name: string;
        channel: string;
      }
    | null;
  date: string | null;
  existingTransfers: ChannelTransfer[];
  availableChannels: string[];
  isLoading: boolean;
  isRefetching: boolean;
  isSaving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (changes: { toCreate: ChannelTransferCreate[]; toDelete: ChannelTransfer[] }) => Promise<void>;
  formatDisplayDate: (iso: string) => string;
  formatNumber: (value?: number | null) => string;
  currentNetMove: number;
  channelMoveValue: number | null;
}

interface DraftTransfer {
  id: string;
  direction: "incoming" | "outgoing";
  otherChannel: string;
  qty: string;
  note: string;
}

const makeDraftId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

const getTransferKey = (transfer: ChannelTransfer) =>
  [
    transfer.session_id,
    transfer.sku_code,
    transfer.warehouse_name,
    transfer.transfer_date,
    transfer.from_channel,
    transfer.to_channel,
  ].join("__");

const getTransferContribution = (transfer: ChannelTransfer, channelName: string) => {
  if (transfer.to_channel === channelName) {
    return transfer.qty;
  }
  if (transfer.from_channel === channelName) {
    return -transfer.qty;
  }
  return 0;
};

const toNullableString = (value: string) => {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

const sanitizeForFilename = (value: string) =>
  value
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[\\/:*?"<>|]+/g, "")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");

const ChannelMoveModal = ({
  isOpen,
  sessionId,
  channel,
  date,
  existingTransfers,
  availableChannels,
  isLoading,
  isRefetching,
  isSaving,
  error,
  onClose,
  onSave,
  formatDisplayDate,
  formatNumber,
  currentNetMove,
  channelMoveValue,
}: ChannelMoveModalProps) => {
  const [drafts, setDrafts] = useState<DraftTransfer[]>([]);
  const [removedTransfers, setRemovedTransfers] = useState<Record<string, true>>({});
  const [localError, setLocalError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const headingId = useId();
  const descriptionId = useId();
  const otherChannelListId = useId();

  const canRender = typeof document !== "undefined";

  const validationMap = useMemo(() => {
    if (!channel) {
      return new Map<string, { valid: boolean; otherChannel?: string; qty?: string }>();
    }

    const map = new Map<string, { valid: boolean; otherChannel?: string; qty?: string }>();
    drafts.forEach((draft) => {
      const issues: { otherChannel?: string; qty?: string } = {};
      const trimmedOther = draft.otherChannel.trim();
      if (!trimmedOther) {
        issues.otherChannel = "チャネルを入力してください";
      } else if (trimmedOther === channel.channel) {
        issues.otherChannel = "同じチャネルを指定することはできません";
      }

      const parsedQty = Number(draft.qty);
      if (!draft.qty.trim()) {
        issues.qty = "数量を入力してください";
      } else if (!Number.isFinite(parsedQty) || parsedQty <= 0) {
        issues.qty = "正の数値を入力してください";
      }

      map.set(draft.id, {
        valid: Object.keys(issues).length === 0,
        ...issues,
      });
    });

    return map;
  }, [channel, drafts]);

  const validDrafts = useMemo(
    () => drafts.filter((draft) => validationMap.get(draft.id)?.valid),
    [drafts, validationMap]
  );

  const hasInvalidDraft = drafts.some((draft) => !(validationMap.get(draft.id)?.valid ?? false));

  const removedList = useMemo(
    () =>
      existingTransfers.filter((transfer) => {
        const key = getTransferKey(transfer);
        return removedTransfers[key];
      }),
    [existingTransfers, removedTransfers]
  );

  const removedContribution = useMemo(() => {
    if (!channel) {
      return 0;
    }
    return removedList.reduce((total, transfer) => total + getTransferContribution(transfer, channel.channel), 0);
  }, [channel, removedList]);

  const draftContribution = useMemo(() => {
    if (!channel) {
      return 0;
    }

    return validDrafts.reduce((total, draft) => {
      const qty = Number(draft.qty);
      if (!Number.isFinite(qty)) {
        return total;
      }
      return draft.direction === "incoming" ? total + qty : total - qty;
    }, 0);
  }, [channel, validDrafts]);

  const previewNetMove = currentNetMove - removedContribution + draftContribution;
  const netDifference = previewNetMove - currentNetMove;

  const hasChanges = removedList.length > 0 || validDrafts.length > 0;
  const disableSave =
    !isOpen || !channel || !date || !sessionId || isSaving || hasInvalidDraft || !hasChanges || isLoading;

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    setDrafts([]);
    setRemovedTransfers({});
    setLocalError(null);
    setIsDownloading(false);
    setDownloadError(null);
  }, [isOpen, channel?.channel, date, existingTransfers]);

  if (!canRender || !isOpen || !channel || !date) {
    return null;
  }

  const handleDownloadPlan = async () => {
    if (!sessionId || !channel || !date || typeof window === "undefined") {
      return;
    }

    setDownloadError(null);
    setIsDownloading(true);

    try {
      const { data } = await api.get<Blob>(
        `/channel-transfers/${encodeURIComponent(sessionId)}/export`,
        {
          params: {
            sku_code: channel.sku_code,
            warehouse_name: channel.warehouse_name,
            channel: channel.channel,
            start_date: date,
            end_date: date,
          },
          responseType: "blob",
        }
      );

      const blob = new Blob([data], { type: "text/csv;charset=utf-8;" });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const filenameParts = [
        "channel-transfer-plan",
        sanitizeForFilename(sessionId),
        sanitizeForFilename(channel.sku_code),
        sanitizeForFilename(channel.warehouse_name),
        sanitizeForFilename(channel.channel),
        date,
      ].filter(Boolean);
      link.href = url;
      link.download = `${filenameParts.join("_") || "channel-transfer-plan"}-${timestamp}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      setDownloadError("チャネル移動計画のダウンロードに失敗しました。");
    } finally {
      setIsDownloading(false);
    }
  };

  const handleAddDraft = () => {
    setDrafts((previous) => [
      ...previous,
      {
        id: makeDraftId(),
        direction: "outgoing",
        otherChannel: "",
        qty: "",
        note: "",
      },
    ]);
  };

  const handleDraftChange = (id: string, patch: Partial<DraftTransfer>) => {
    setDrafts((previous) => previous.map((draft) => (draft.id === id ? { ...draft, ...patch } : draft)));
  };

  const handleRemoveDraft = (id: string) => {
    setDrafts((previous) => previous.filter((draft) => draft.id !== id));
  };

  const toggleRemoveTransfer = (transfer: ChannelTransfer) => {
    const key = getTransferKey(transfer);
    setRemovedTransfers((previous) => {
      if (previous[key]) {
        const next = { ...previous };
        delete next[key];
        return next;
      }
      return { ...previous, [key]: true };
    });
  };

  const handleSave = async () => {
    if (!channel || !date) {
      return;
    }

    if (hasInvalidDraft) {
      setLocalError("入力内容を確認してください。");
      return;
    }

    if (!hasChanges) {
      setLocalError("追加または削除する移動がありません。");
      return;
    }

    setLocalError(null);

    const payload: ChannelTransferCreate[] = validDrafts.map((draft) => {
      const trimmedOther = draft.otherChannel.trim();
      const qty = Number(draft.qty);
      const from_channel = draft.direction === "outgoing" ? channel.channel : trimmedOther;
      const to_channel = draft.direction === "incoming" ? channel.channel : trimmedOther;

      return {
        session_id: sessionId,
        sku_code: channel.sku_code,
        warehouse_name: channel.warehouse_name,
        transfer_date: date,
        from_channel,
        to_channel,
        qty,
        note: toNullableString(draft.note),
      };
    });

    const toDelete = removedList;

    await onSave({ toCreate: payload, toDelete });
  };

  const combinedError = localError ?? error;

  const modal = (
    <div className="channel-move-modal-backdrop" onClick={onClose}>
      <div
        className="channel-move-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={descriptionId}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="channel-move-modal__header">
          <div>
            <h2 id={headingId}>チャネル移動の編集</h2>
            <p className="channel-move-modal__subtitle" id={descriptionId}>
              {channel.sku_code} {channel.sku_name ? `(${channel.sku_name})` : ""} / {channel.warehouse_name} / {channel.channel}
              <br />
              {formatDisplayDate(date)} の移動履歴
            </p>
          </div>
          <button type="button" className="channel-move-modal__close" onClick={onClose} aria-label="閉じる">
            ×
          </button>
        </header>

        <div className="channel-move-modal__content">
          <div className="channel-move-modal__actions">
            <button
              type="button"
              className="psi-button secondary"
              onClick={handleDownloadPlan}
              disabled={isDownloading}
            >
              {isDownloading ? "ダウンロード中..." : "チャネル移動計画をダウンロード"}
            </button>
            {downloadError && (
              <p className="channel-move-modal__error" role="alert">
                {downloadError}
              </p>
            )}
          </div>
          <div className="channel-move-modal__summary" aria-live="polite">
            <div>
              <span className="channel-move-modal__summary-label">PSIのchannel_move</span>
              <span className="channel-move-modal__summary-value">{formatNumber(channelMoveValue)}</span>
            </div>
            <div>
              <span className="channel-move-modal__summary-label">移動履歴の純移動量</span>
              <span className="channel-move-modal__summary-value">{formatNumber(currentNetMove)}</span>
            </div>
            <div>
              <span className="channel-move-modal__summary-label">保存後の予測</span>
              <span className="channel-move-modal__summary-value">
                {formatNumber(previewNetMove)}
                {netDifference !== 0 && (
                  <span className="channel-move-modal__summary-delta">
                    {netDifference > 0 ? "+" : ""}
                    {formatNumber(netDifference)}
                  </span>
                )}
              </span>
            </div>
          </div>

          {isLoading ? (
            <p className="channel-move-modal__status">移動データを読み込み中です…</p>
          ) : (
            <div className="channel-move-modal__section">
              <h3>既存の移動</h3>
              {existingTransfers.length === 0 ? (
                <p className="channel-move-modal__status">登録済みの移動はありません。</p>
              ) : (
                <table className="channel-move-modal__table">
                  <thead>
                    <tr>
                      <th scope="col">方向</th>
                      <th scope="col">相手チャネル</th>
                      <th scope="col">数量</th>
                      <th scope="col">メモ</th>
                      <th scope="col" aria-label="操作" />
                    </tr>
                  </thead>
                  <tbody>
                    {existingTransfers.map((transfer) => {
                      const key = getTransferKey(transfer);
                      const marked = Boolean(removedTransfers[key]);
                      const isIncoming = transfer.to_channel === channel.channel;
                      const counterpart = isIncoming ? transfer.from_channel : transfer.to_channel;
                      return (
                        <tr key={key} className={marked ? "channel-move-modal__row--removed" : undefined}>
                          <td>{isIncoming ? "入庫" : "出庫"}</td>
                          <td>{counterpart}</td>
                          <td className="numeric">{formatNumber(transfer.qty)}</td>
                          <td>{transfer.note ?? "—"}</td>
                          <td>
                            <button
                              type="button"
                              className="psi-button secondary"
                              onClick={() => toggleRemoveTransfer(transfer)}
                            >
                              {marked ? "削除を取り消す" : "削除する"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
              {isRefetching && <p className="channel-move-modal__status">最新の移動情報を取得しています…</p>}
            </div>
          )}

          <div className="channel-move-modal__section">
            <div className="channel-move-modal__section-header">
              <h3>移動を追加</h3>
              <button type="button" className="psi-button secondary" onClick={handleAddDraft}>
                行を追加
              </button>
            </div>
            {drafts.length === 0 ? (
              <p className="channel-move-modal__status">「行を追加」から新しい移動を登録できます。</p>
            ) : (
              <table className="channel-move-modal__table">
                <thead>
                  <tr>
                    <th scope="col">方向</th>
                    <th scope="col">相手チャネル</th>
                    <th scope="col">数量</th>
                    <th scope="col">メモ</th>
                    <th scope="col" aria-label="操作" />
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((draft) => {
                    const validation = validationMap.get(draft.id);
                    return (
                      <tr key={draft.id}>
                        <td>
                          <select
                            value={draft.direction}
                            onChange={(event) =>
                              handleDraftChange(draft.id, {
                                direction: event.target.value as DraftTransfer["direction"],
                              })
                            }
                          >
                            <option value="outgoing">出庫（{channel.channel} →）</option>
                            <option value="incoming">入庫（→ {channel.channel}）</option>
                          </select>
                        </td>
                        <td>
                          <input
                            list={otherChannelListId}
                            value={draft.otherChannel}
                            onChange={(event) => handleDraftChange(draft.id, { otherChannel: event.target.value })}
                            aria-invalid={validation?.otherChannel ? "true" : "false"}
                          />
                          {validation?.otherChannel && (
                            <span className="channel-move-modal__field-error">{validation.otherChannel}</span>
                          )}
                        </td>
                        <td>
                          <input
                            type="number"
                            inputMode="decimal"
                            value={draft.qty}
                            onChange={(event) => handleDraftChange(draft.id, { qty: event.target.value })}
                            aria-invalid={validation?.qty ? "true" : "false"}
                          />
                          {validation?.qty && (
                            <span className="channel-move-modal__field-error">{validation.qty}</span>
                          )}
                        </td>
                        <td>
                          <input
                            value={draft.note}
                            onChange={(event) => handleDraftChange(draft.id, { note: event.target.value })}
                            placeholder="任意"
                          />
                        </td>
                        <td>
                          <button
                            type="button"
                            className="psi-button secondary"
                            onClick={() => handleRemoveDraft(draft.id)}
                          >
                            行を削除
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
            <datalist id={otherChannelListId}>
              {availableChannels.map((option) => (
                <option key={option} value={option} />
              ))}
              {drafts.map((draft) => {
                const trimmedOther = draft.otherChannel.trim();
                if (!trimmedOther || availableChannels.includes(trimmedOther)) {
                  return null;
                }
                return <option key={`draft-${draft.id}`} value={trimmedOther} />;
              })}
            </datalist>
          </div>

          {combinedError && <p className="channel-move-modal__error" role="alert">{combinedError}</p>}
        </div>

        <footer className="channel-move-modal__footer">
          <button type="button" className="psi-button secondary" onClick={onClose} disabled={isSaving}>
            キャンセル
          </button>
          <button type="button" className="psi-button primary" onClick={handleSave} disabled={disableSave}>
            {isSaving ? "保存中..." : "保存"}
          </button>
        </footer>
      </div>
    </div>
  );

  return createPortal(modal, document.body);
};

export default ChannelMoveModal;
