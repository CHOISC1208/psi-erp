import { FormEvent, useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import api from "../lib/api";
import { useSessionsQuery } from "../hooks/usePsiQueries";
import type { ChannelTransfer, ChannelTransferIdentifier } from "../types";

interface FilterState {
  sku_code: string;
  warehouse_name: string;
  updated_at: string;
  username: string;
}

type StatusMessage = { type: "success" | "error"; text: string };

interface RowEditState {
  qty: string;
  note: string;
}

interface UpdateArgs {
  identifier: ChannelTransferIdentifier;
  payload: { qty?: number; note?: string | null };
}

const getTodayIso = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail;
    if (detail) {
      return detail;
    }
    if (error.message) {
      return error.message;
    }
  } else if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};

const fetchTransfers = async (
  sessionId: string,
  filters: FilterState,
): Promise<ChannelTransfer[]> => {
  const params: Record<string, string> = { session_id: sessionId };
  if (filters.sku_code.trim()) {
    params.sku_code = filters.sku_code.trim();
  }
  if (filters.warehouse_name.trim()) {
    params.warehouse_name = filters.warehouse_name.trim();
  }
  if (filters.updated_at) {
    params.updated_at = filters.updated_at;
  }
  if (filters.username.trim()) {
    params.username = filters.username.trim();
  }

  const { data } = await api.get<ChannelTransfer[]>("/channel-transfers/", { params });
  return data;
};

const updateTransfer = async ({ identifier, payload }: UpdateArgs): Promise<ChannelTransfer> => {
  const { session_id, sku_code, warehouse_name, transfer_date, from_channel, to_channel } = identifier;
  const path = `/channel-transfers/${encodeURIComponent(session_id)}/${encodeURIComponent(
    sku_code,
  )}/${encodeURIComponent(warehouse_name)}/${encodeURIComponent(transfer_date)}/${encodeURIComponent(
    from_channel,
  )}/${encodeURIComponent(to_channel)}`;
  const { data } = await api.put<ChannelTransfer>(path, payload);
  return data;
};

const buildRowKey = (transfer: ChannelTransfer | ChannelTransferIdentifier) =>
  [
    transfer.session_id,
    transfer.sku_code,
    transfer.warehouse_name,
    transfer.transfer_date,
    transfer.from_channel,
    transfer.to_channel,
  ].join("|");

const buildUpdatePayload = (
  transfer: ChannelTransfer,
  draft: RowEditState,
) => {
  const qtyValue = Number.parseFloat(draft.qty);
  if (Number.isNaN(qtyValue)) {
    return { type: "error" as const, message: "Quantity must be a valid number." };
  }

  const trimmedNote = draft.note.trim();
  const nextNote = trimmedNote.length > 0 ? trimmedNote : null;

  const payload: UpdateArgs["payload"] = {};
  if (qtyValue !== transfer.qty) {
    payload.qty = qtyValue;
  }
  if (nextNote !== (transfer.note ?? null)) {
    payload.note = nextNote;
  }

  return {
    type: "success" as const,
    payload,
    hasChanges: Object.keys(payload).length > 0,
  };
};

const defaultFilters = (): FilterState => ({
  sku_code: "",
  warehouse_name: "",
  updated_at: getTodayIso(),
  username: "",
});

export default function TransferPage() {
  const queryClient = useQueryClient();
  const sessionsQuery = useSessionsQuery();
  const sessions = sessionsQuery.data ?? [];
  const leaderSession = useMemo(
    () => sessions.find((session) => session.is_leader) ?? null,
    [sessions],
  );

  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [filterDraft, setFilterDraft] = useState<FilterState>(defaultFilters);
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(defaultFilters);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [editState, setEditState] = useState<Record<string, RowEditState>>({});
  const [updatingKeys, setUpdatingKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!selectedSessionId && sessions.length) {
      const fallback = leaderSession ?? sessions[0];
      setSelectedSessionId(fallback.id);
    }
  }, [leaderSession, selectedSessionId, sessions]);

  useEffect(() => {
    setFilterDraft(defaultFilters());
    setAppliedFilters(defaultFilters());
  }, [selectedSessionId]);

  const transfersQueryKey = useMemo(
    () => [
      "transfer-list",
      selectedSessionId,
      appliedFilters.sku_code,
      appliedFilters.warehouse_name,
      appliedFilters.updated_at,
      appliedFilters.username,
    ],
    [selectedSessionId, appliedFilters],
  );

  const transfersQuery = useQuery({
    queryKey: transfersQueryKey,
    queryFn: () => fetchTransfers(selectedSessionId, appliedFilters),
    enabled: Boolean(selectedSessionId),
  });

  const transfers = transfersQuery.data ?? [];

  useEffect(() => {
    const nextState: Record<string, RowEditState> = {};
    transfers.forEach((transfer) => {
      nextState[buildRowKey(transfer)] = {
        qty: String(transfer.qty ?? ""),
        note: transfer.note ?? "",
      };
    });
    setEditState(nextState);
  }, [transfers]);

  const updateMutation = useMutation({
    mutationFn: updateTransfer,
  });

  const transfersByKey = useMemo(() => {
    const map = new Map<string, ChannelTransfer>();
    transfers.forEach((transferItem) => {
      map.set(buildRowKey(transferItem), transferItem);
    });
    return map;
  }, [transfers]);

  const findCounterpart = (transfer: ChannelTransfer) => {
    const counterpartIdentifier: ChannelTransferIdentifier = {
      session_id: transfer.session_id,
      sku_code: transfer.sku_code,
      warehouse_name: transfer.warehouse_name,
      transfer_date: transfer.transfer_date,
      from_channel: transfer.to_channel,
      to_channel: transfer.from_channel,
    };
    return transfersByKey.get(buildRowKey(counterpartIdentifier)) ?? null;
  };

  const handleApplyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedFilters(filterDraft);
  };

  const handleResetFilters = () => {
    const defaults = defaultFilters();
    setFilterDraft(defaults);
    setAppliedFilters(defaults);
  };

  const handleRowChange = (key: string, field: keyof RowEditState, value: string) => {
    setEditState((previous) => ({
      ...previous,
      [key]: {
        ...previous[key],
        [field]: value,
      },
    }));
  };

  const handleApplyRow = async (transfer: ChannelTransfer) => {
    const key = buildRowKey(transfer);
    const draft = editState[key];
    if (!draft) {
      return;
    }

    const primaryResult = buildUpdatePayload(transfer, draft);
    if (primaryResult.type === "error") {
      setStatus({ type: "error", text: primaryResult.message });
      return;
    }

    const primaryHasChanges = primaryResult.hasChanges;

    const identifier: ChannelTransferIdentifier = {
      session_id: transfer.session_id,
      sku_code: transfer.sku_code,
      warehouse_name: transfer.warehouse_name,
      transfer_date: transfer.transfer_date,
      from_channel: transfer.from_channel,
      to_channel: transfer.to_channel,
    };

    const updates: UpdateArgs[] = [];

    const counterpart = findCounterpart(transfer);
    let counterpartHasChanges = false;

    if (counterpart) {
      const counterpartKey = buildRowKey(counterpart);
      const counterpartDraft = editState[counterpartKey];

      if (!counterpartDraft) {
        setStatus({
          type: "error",
          text: "Paired transfer data is unavailable. Refresh and try again.",
        });
        return;
      }

      const counterpartResult = buildUpdatePayload(counterpart, counterpartDraft);
      if (counterpartResult.type === "error") {
        setStatus({ type: "error", text: counterpartResult.message });
        return;
      }

      counterpartHasChanges = counterpartResult.hasChanges;

      if (primaryHasChanges !== counterpartHasChanges) {
        if (primaryHasChanges) {
          setStatus({
            type: "error",
            text: `This transfer is paired with ${counterpart.from_channel} → ${counterpart.to_channel}. Update both entries before applying.`,
          });
        } else {
          setStatus({
            type: "error",
            text: `Changes exist on the paired transfer (${counterpart.from_channel} → ${counterpart.to_channel}). Apply updates from that row or align both entries.`,
          });
        }
        return;
      }

      if (counterpartHasChanges) {
        updates.push({
          identifier: {
            session_id: counterpart.session_id,
            sku_code: counterpart.sku_code,
            warehouse_name: counterpart.warehouse_name,
            transfer_date: counterpart.transfer_date,
            from_channel: counterpart.from_channel,
            to_channel: counterpart.to_channel,
          },
          payload: counterpartResult.payload,
        });
      }
    }

    if (!primaryHasChanges && !counterpartHasChanges) {
      setStatus({ type: "error", text: "No changes to apply." });
      return;
    }

    if (primaryHasChanges) {
      updates.push({ identifier, payload: primaryResult.payload });
    }

    setStatus(null);
    const keysInFlight = new Set(updates.map((update) => buildRowKey(update.identifier)));
    setUpdatingKeys(keysInFlight);

    try {
      for (const update of updates) {
        // eslint-disable-next-line no-await-in-loop
        await updateMutation.mutateAsync(update);
      }
      setStatus({
        type: "success",
        text: updates.length > 1 ? "Transfers updated." : "Transfer updated.",
      });
    } catch (error) {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Unable to update transfer. Try again."),
      });
    } finally {
      setUpdatingKeys(new Set());
      queryClient.invalidateQueries({ queryKey: transfersQueryKey });
    }
  };

  const handleResetRow = (transfer: ChannelTransfer) => {
    const key = buildRowKey(transfer);
    const nextState: Record<string, RowEditState> = {
      [key]: {
        qty: String(transfer.qty ?? ""),
        note: transfer.note ?? "",
      },
    };

    const counterpart = findCounterpart(transfer);
    if (counterpart) {
      const counterpartKey = buildRowKey(counterpart);
      nextState[counterpartKey] = {
        qty: String(counterpart.qty ?? ""),
        note: counterpart.note ?? "",
      };
    }

    setEditState((previous) => ({
      ...previous,
      ...nextState,
    }));
    setStatus(null);
  };

  const handleDownload = async () => {
    if (!selectedSessionId) {
      return;
    }
    try {
      const params: Record<string, string> = {};
      if (appliedFilters.sku_code.trim()) {
        params.sku_code = appliedFilters.sku_code.trim();
      }
      if (appliedFilters.warehouse_name.trim()) {
        params.warehouse_name = appliedFilters.warehouse_name.trim();
      }
      if (appliedFilters.updated_at) {
        params.updated_at = appliedFilters.updated_at;
      }
      if (appliedFilters.username.trim()) {
        params.username = appliedFilters.username.trim();
      }

      const response = await api.get<Blob>(`/channel-transfers/${selectedSessionId}/export`, {
        params,
        responseType: "blob",
      });

      const blob = new Blob([response.data], {
        type: response.headers["content-type"] ?? "text/csv;charset=utf-8",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const disposition = response.headers["content-disposition"];
      const match = typeof disposition === "string" ? disposition.match(/filename="?([^";]+)"?/i) : null;
      const filename = match?.[1] ?? `channel-transfers-${selectedSessionId}.csv`;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setStatus({ type: "error", text: getErrorMessage(error, "Unable to download CSV.") });
    }
  };

  return (
    <div className="page transfer-page">
      <header>
        <h1>Channel Transfers</h1>
        <p>Review and update recorded transfers between channels for each session.</p>
      </header>

      {status ? <div className={`status-message ${status.type}`}>{status.text}</div> : null}

      <section className="filters">
        <h2>Filters</h2>
        <form className="filter-form" onSubmit={handleApplyFilters}>
          <label>
            Session
            <select
              value={selectedSessionId}
              onChange={(event) => {
                setSelectedSessionId(event.target.value);
                setStatus(null);
              }}
              required
            >
              <option value="" disabled>
                Select session
              </option>
              {sessions.map((session) => (
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
              value={filterDraft.sku_code}
              onChange={(event) =>
                setFilterDraft((previous) => ({ ...previous, sku_code: event.target.value }))
              }
              placeholder="Contains…"
            />
          </label>
          <label>
            Warehouse
            <input
              type="text"
              value={filterDraft.warehouse_name}
              onChange={(event) =>
                setFilterDraft((previous) => ({ ...previous, warehouse_name: event.target.value }))
              }
              placeholder="Contains…"
            />
          </label>
          <label>
            Updated Date
            <input
              type="date"
              value={filterDraft.updated_at}
              onChange={(event) =>
                setFilterDraft((previous) => ({ ...previous, updated_at: event.target.value }))
              }
            />
          </label>
          <label>
            Username
            <input
              type="text"
              value={filterDraft.username}
              onChange={(event) =>
                setFilterDraft((previous) => ({ ...previous, username: event.target.value }))
              }
              placeholder="Contains…"
            />
          </label>
          <div className="filter-actions">
            <button type="submit" disabled={!selectedSessionId}>
              apply
            </button>
            <button type="button" className="secondary" onClick={handleResetFilters}>
              reset
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleDownload}
              disabled={!selectedSessionId}
            >
              DL
            </button>
          </div>
        </form>
      </section>

      <section>
        <h2>Transfer Records</h2>
        {transfersQuery.isLoading && !transfers.length ? <p>Loading transfers…</p> : null}
        {transfersQuery.error ? (
          <p className="error-text">Failed to load transfers. Please try again.</p>
        ) : null}
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>SKU</th>
                <th>Warehouse</th>
                <th>From</th>
                <th>To</th>
                <th>Quantity</th>
                <th>Note</th>
                <th>Created By</th>
                <th>Updated By</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {transfers.map((transfer) => {
                const key = buildRowKey(transfer);
                const rowDraft = editState[key] ?? { qty: "", note: "" };
                return (
                  <tr key={key}>
                    <td>{transfer.transfer_date}</td>
                    <td>{transfer.sku_code}</td>
                    <td>{transfer.warehouse_name}</td>
                    <td>{transfer.from_channel}</td>
                    <td>{transfer.to_channel}</td>
                    <td>
                      <input
                        type="number"
                        step="any"
                        value={rowDraft.qty}
                        onChange={(event) => handleRowChange(key, "qty", event.target.value)}
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        value={rowDraft.note}
                        onChange={(event) => handleRowChange(key, "note", event.target.value)}
                      />
                    </td>
                    <td>
                      <div>{transfer.created_by_username ?? "—"}</div>
                      <small>{new Date(transfer.created_at).toLocaleString()}</small>
                    </td>
                    <td>
                      <div>{transfer.updated_by_username ?? "—"}</div>
                      <small>{new Date(transfer.updated_at).toLocaleString()}</small>
                    </td>
                    <td className="actions">
                      <div className="action-buttons">
                        <button
                          type="button"
                          onClick={() => {
                            void handleApplyRow(transfer);
                          }}
                          disabled={updatingKeys.has(key)}
                        >
                          {updatingKeys.has(key) ? "Saving..." : "Apply"}
                        </button>
                        <button
                          type="button"
                          className="secondary"
                          onClick={() => handleResetRow(transfer)}
                          disabled={updatingKeys.has(key)}
                        >
                          Reset
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
                {transfers.length === 0 ? (
                  <tr>
                    <td colSpan={10}>No transfers match the selected filters.</td>
                  </tr>
                ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
