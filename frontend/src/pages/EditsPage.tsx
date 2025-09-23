import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import axios from "axios";

import api from "../lib/api";
import { useSessionsQuery } from "../hooks/usePsiQueries";
import type { PSIEditRecord } from "../types";

interface FilterState {
  sku_code: string;
  warehouse_name: string;
  updated_at: string;
  username: string;
}

type StatusMessage = { type: "success" | "error"; text: string };

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

const defaultFilters = (): FilterState => ({
  sku_code: "",
  warehouse_name: "",
  updated_at: getTodayIso(),
  username: "",
});

const fetchEdits = async (
  sessionId: string,
  filters: FilterState,
): Promise<PSIEditRecord[]> => {
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

  const { data } = await api.get<PSIEditRecord[]>("/psi-edits/", { params });
  return data;
};

export default function EditsPage() {
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

  useEffect(() => {
    if (!selectedSessionId && sessions.length) {
      const fallback = leaderSession ?? sessions[0];
      setSelectedSessionId(fallback.id);
    }
  }, [leaderSession, selectedSessionId, sessions]);

  useEffect(() => {
    const defaults = defaultFilters();
    setFilterDraft(defaults);
    setAppliedFilters(defaults);
  }, [selectedSessionId]);

  const editsQueryKey = useMemo(
    () => [
      "psi-edit-list",
      selectedSessionId,
      appliedFilters.sku_code,
      appliedFilters.warehouse_name,
      appliedFilters.updated_at,
      appliedFilters.username,
    ],
    [selectedSessionId, appliedFilters],
  );

  const editsQuery = useQuery({
    queryKey: editsQueryKey,
    queryFn: () => fetchEdits(selectedSessionId, appliedFilters),
    enabled: Boolean(selectedSessionId),
  });

  const edits = editsQuery.data ?? [];

  const handleApplyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedFilters(filterDraft);
    setStatus(null);
  };

  const handleResetFilters = () => {
    const defaults = defaultFilters();
    setFilterDraft(defaults);
    setAppliedFilters(defaults);
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

      const response = await api.get<Blob>(`/psi-edits/${selectedSessionId}/export`, {
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
      const filename = match?.[1] ?? `psi-edits-${selectedSessionId}.csv`;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setStatus({ type: "success", text: "CSV download started." });
    } catch (error) {
      setStatus({ type: "error", text: getErrorMessage(error, "Unable to download CSV.") });
    }
  };

  return (
    <div className="page transfer-page">
      <header>
        <h1>PSI Edits</h1>
        <p>Review manual PSI overrides and audit who made each change.</p>
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
        <h2>PSI Edit Records</h2>
        {editsQuery.isLoading && !edits.length ? <p>Loading edits…</p> : null}
        {editsQuery.error ? (
          <p className="error-text">Failed to load PSI edits. Please try again.</p>
        ) : null}
        <div className="table-container">
          <table className="data-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>SKU</th>
                <th>Warehouse</th>
                <th>Channel</th>
                <th>Inbound Qty</th>
                <th>Outbound Qty</th>
                <th>Safety Stock</th>
                <th>Created By</th>
                <th>Updated By</th>
              </tr>
            </thead>
            <tbody>
              {edits.map((edit) => (
                <tr key={edit.id}>
                  <td>{edit.date}</td>
                  <td>{edit.sku_code}</td>
                  <td>{edit.warehouse_name}</td>
                  <td>{edit.channel}</td>
                  <td>{edit.inbound_qty ?? "—"}</td>
                  <td>{edit.outbound_qty ?? "—"}</td>
                  <td>{edit.safety_stock ?? "—"}</td>
                  <td>
                    <div>{edit.created_by_username ?? "—"}</div>
                    <small>{new Date(edit.created_at).toLocaleString()}</small>
                  </td>
                  <td>
                    <div>{edit.updated_by_username ?? "—"}</div>
                    <small>{new Date(edit.updated_at).toLocaleString()}</small>
                  </td>
                </tr>
              ))}
              {edits.length === 0 ? (
                <tr>
                  <td colSpan={9}>No edits match the selected filters.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
