import {
  ChangeEvent,
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

import api from "../lib/api";
import { useSessionsQuery } from "../hooks/usePsiQueries";
import type { Session, SessionDatasetMetadata } from "../types";

type StatusMessage = { type: "success" | "error"; text: string };

interface DatasetFilters {
  sku_code: string;
  warehouse_name: string;
  channel: string;
  fw_rank: string;
  ss_rank: string;
  date_start: string;
  date_end: string;
}

const defaultFilters = (): DatasetFilters => ({
  sku_code: "",
  warehouse_name: "",
  channel: "",
  fw_rank: "",
  ss_rank: "",
  date_start: "",
  date_end: "",
});

const PAGE_SIZE_OPTIONS = [25, 50, 100];

const ROW_KEY_DELIMITER = "\u0000";

type DatasetRow = Record<string, unknown> & { session_id: string };

interface DatasetPage {
  page: number;
  size: number;
  total: number;
  rows: DatasetRow[];
}

const makeRowKey = (row: DatasetRow, primaryKey: string[]) =>
  primaryKey.map((column) => String(row[column] ?? "")).join(ROW_KEY_DELIMITER);

const getErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const detailPayload = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detailPayload === "string" && detailPayload.trim().length > 0) {
      return detailPayload;
    }
    if (
      detailPayload &&
      typeof detailPayload === "object" &&
      "message" in detailPayload &&
      typeof (detailPayload as { message?: unknown }).message === "string"
    ) {
      return String((detailPayload as { message: string }).message);
    }
    if (error.message) {
      return error.message;
    }
  } else if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};

const fetchDatasets = async (sessionId: string): Promise<SessionDatasetMetadata[]> => {
  const { data } = await api.get<SessionDatasetMetadata[]>(
    `/sessions/${sessionId}/datasets`,
  );
  return data;
};

const DATASET_ENDPOINTS: Record<string, string> = {
  psi_base: "psi_base",
  psi_summary_base: "psi_summary_base",
};

const DATASET_FILTER_KEYS: Record<string, (keyof DatasetFilters)[]> = {
  psi_base: [
    "sku_code",
    "warehouse_name",
    "channel",
    "fw_rank",
    "ss_rank",
    "date_start",
    "date_end",
  ],
  psi_summary_base: ["sku_code", "warehouse_name", "channel"],
};

const fetchDatasetPage = async (
  sessionId: string,
  datasetName: string,
  filters: Record<string, string>,
  page: number,
  size: number,
): Promise<DatasetPage> => {
  const params: Record<string, string> = {
    page: String(page),
    size: String(size),
  };
  if (Object.keys(filters).length > 0) {
    params.filters = JSON.stringify(filters);
  }
  const endpoint = DATASET_ENDPOINTS[datasetName];
  if (!endpoint) {
    throw new Error(`Unsupported dataset: ${datasetName}`);
  }
  const { data } = await api.get<DatasetPage>(
    `/sessions/${sessionId}/${endpoint}`,
    { params },
  );
  return data;
};

const saveDatasetEdits = async (
  sessionId: string,
  datasetName: string,
  rows: Record<string, unknown>[],
) => {
  const endpoint = DATASET_ENDPOINTS[datasetName];
  if (!endpoint) {
    throw new Error(`Unsupported dataset: ${datasetName}`);
  }
  await api.patch(`/sessions/${sessionId}/${endpoint}`, { rows });
};

const deleteDatasetRows = async (
  sessionId: string,
  datasetName: string,
  rows: Record<string, unknown>[],
) => {
  const endpoint = DATASET_ENDPOINTS[datasetName];
  if (!endpoint) {
    throw new Error(`Unsupported dataset: ${datasetName}`);
  }
  await api.delete(`/sessions/${sessionId}/${endpoint}`, { data: { rows } });
};

const sanitizeFilters = (
  filters: DatasetFilters,
  datasetName?: string,
): Record<string, string> => {
  const allowed = DATASET_FILTER_KEYS[datasetName ?? "psi_base"] ?? [];
  const allowedSet = new Set<keyof DatasetFilters>(allowed);
  const entries = Object.entries(filters)
    .filter(([key]) => (allowedSet.size === 0 ? true : allowedSet.has(key as keyof DatasetFilters)))
    .map(([key, value]) => [key, value.trim()] as const)
    .filter(([, value]) => value.length > 0);
  return Object.fromEntries(entries);
};

const getSessionLabel = (session: Session) =>
  session.title ?? session.id.slice(0, 8);

export default function EditsPage() {
  const queryClient = useQueryClient();
  const sessionsQuery = useSessionsQuery();
  const sessions = sessionsQuery.data ?? [];

  const [sessionSearch, setSessionSearch] = useState("");
  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [tableFilters, setTableFilters] = useState<DatasetFilters>(defaultFilters);
  const [pendingFilters, setPendingFilters] = useState<DatasetFilters>(defaultFilters);
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState<number>(1);
  const [status, setStatus] = useState<StatusMessage | null>(null);

  const baseSessions = useMemo(
    () =>
      sessions.filter((session) => {
        const mode = (session.data_mode ?? session.data_type)?.toLowerCase();
        return mode === "base";
      }),
    [sessions],
  );

  const filteredSessions = useMemo(() => {
    const term = sessionSearch.trim().toLowerCase();
    if (!term) {
      return sessions;
    }
    return sessions.filter((session) =>
      [session.title, session.description]
        .filter(Boolean)
        .some((value) => value?.toLowerCase().includes(term)),
    );
  }, [sessions, sessionSearch]);

  const showNoSessions =
    !sessionsQuery.isLoading && !sessionsQuery.isError && sessions.length === 0;
  const showMissingBaseSessionHint =
    !sessionsQuery.isLoading &&
    !sessionsQuery.isError &&
    sessions.length > 0 &&
    baseSessions.length === 0;

  useEffect(() => {
    if (filteredSessions.length === 0) {
      setSelectedSessionId("");
      return;
    }
    if (!selectedSessionId) {
      setSelectedSessionId(filteredSessions[0].id);
      return;
    }
    const exists = filteredSessions.some((session) => session.id === selectedSessionId);
    if (!exists) {
      setSelectedSessionId(filteredSessions[0].id);
    }
  }, [filteredSessions, selectedSessionId]);

  useEffect(() => {
    setTableFilters(defaultFilters());
    setPendingFilters(defaultFilters());
    setPage(1);
    setStatus(null);
  }, [selectedSessionId]);

  const datasetsQuery = useQuery({
    queryKey: ["session-datasets", selectedSessionId],
    queryFn: () => fetchDatasets(selectedSessionId),
    enabled: Boolean(selectedSessionId),
  });

  const datasets = datasetsQuery.data ?? [];

  const selectedDataset = useMemo(() => {
    if (datasets.length === 0) {
      return null;
    }
    const baseDataset = datasets.find((dataset) => dataset.name === "psi_base");
    return baseDataset ?? datasets[0];
  }, [datasets]);

  const datasetPrimaryKey = useMemo(
    () => (selectedDataset ? [...selectedDataset.primary_key] : []),
    [selectedDataset],
  );

  const getRowKey = useCallback(
    (row: DatasetRow) => makeRowKey(row, datasetPrimaryKey),
    [datasetPrimaryKey],
  );

  const sanitizedFilters = useMemo(
    () => sanitizeFilters(tableFilters, selectedDataset?.name),
    [tableFilters, selectedDataset?.name],
  );

  const tableQuery = useQuery({
    queryKey: [
      "session-dataset",
      selectedSessionId,
      selectedDataset?.name,
      JSON.stringify(sanitizedFilters),
      page,
      pageSize,
    ],
    queryFn: () =>
      fetchDatasetPage(
        selectedSessionId,
        selectedDataset!.name,
        sanitizedFilters,
        page,
        pageSize,
      ),
    enabled: Boolean(selectedSessionId && selectedDataset),
  });

  const originalRows = tableQuery.data?.rows ?? [];
  const originalRowMap = useMemo(() => {
    const map = new Map<string, DatasetRow>();
    originalRows.forEach((row) => {
      map.set(getRowKey(row), row);
    });
    return map;
  }, [getRowKey, originalRows]);

  const [localRows, setLocalRows] = useState<DatasetRow[]>([]);
  const [edits, setEdits] = useState<Map<string, Record<string, string>>>(
    () => new Map(),
  );
  const [selectedRowKeys, setSelectedRowKeys] = useState<Set<string>>(
    () => new Set(),
  );

  useEffect(() => {
    setLocalRows(originalRows);
    setEdits(new Map());
    setSelectedRowKeys(new Set());
  }, [originalRows]);

  const editableColumns = useMemo(() => {
    if (!selectedDataset) {
      return new Set<string>();
    }
    return new Set(
      selectedDataset.columns
        .filter((column) => column.editable)
        .map((column) => column.name),
    );
  }, [selectedDataset]);

  const numericColumns = useMemo(() => {
    if (!selectedDataset) {
      return new Set<string>();
    }
    return new Set(selectedDataset.numeric_columns);
  }, [selectedDataset]);

  const hasEdits = edits.size > 0;

  const handleFilterSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTableFilters(pendingFilters);
    setPage(1);
    setStatus(null);
  };

  const handleFilterChange = (
    event: ChangeEvent<HTMLInputElement>,
    field: keyof DatasetFilters,
  ) => {
    const value = event.target.value;
    setPendingFilters((prev) => ({ ...prev, [field]: value }));
  };

  const handlePageChange = (nextPage: number) => {
    setPage(nextPage);
    setSelectedRowKeys(new Set());
  };

  const handlePageSizeChange = (event: ChangeEvent<HTMLSelectElement>) => {
    const nextSize = Number(event.target.value);
    setPageSize(nextSize);
    setPage(1);
  };

  const handleCellChange = (
    rowKey: string,
    field: string,
    value: string,
  ) => {
    setLocalRows((prev) =>
      prev.map((row) =>
        getRowKey(row) === rowKey ? { ...row, [field]: value } : row,
      ),
    );
    setEdits((prev) => {
      const next = new Map(prev);
      const original = originalRowMap.get(rowKey);
      const base = next.get(rowKey) ?? {};
      const normalizedValue = value;
      const originalValue = original ? (original[field] as unknown) : "";
      const normalizedOriginal =
        originalValue === null || originalValue === undefined
          ? ""
          : String(originalValue);
      if (normalizedValue === normalizedOriginal) {
        const updated = { ...base } as Record<string, string>;
        delete updated[field];
        if (Object.keys(updated).length === 0) {
          next.delete(rowKey);
        } else {
          next.set(rowKey, updated);
        }
      } else {
        next.set(rowKey, { ...base, [field]: normalizedValue });
      }
      return next;
    });
  };

  const handleRowSelection = (rowKey: string, checked: boolean) => {
    setSelectedRowKeys((prev) => {
      const next = new Set(prev);
      if (checked) {
        next.add(rowKey);
      } else {
        next.delete(rowKey);
      }
      return next;
    });
  };

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSessionId || edits.size === 0 || !selectedDataset) {
        return;
      }
      const rows: Record<string, unknown>[] = [];
      edits.forEach((changes, key) => {
        const original = originalRowMap.get(key);
        if (!original) {
          return;
        }
        const payload: Record<string, unknown> = {};
        datasetPrimaryKey.forEach((column) => {
          if (column === "session_id") {
            payload[column] = selectedSessionId;
          } else {
            payload[column] = original[column];
          }
        });
        if (!("session_id" in payload)) {
          payload.session_id = selectedSessionId;
        }
        Object.entries(changes).forEach(([field, rawValue]) => {
          if (!editableColumns.has(field)) {
            return;
          }
          const value = rawValue ?? "";
          if (numericColumns.has(field)) {
            const trimmed = typeof value === "string" ? value.trim() : String(value ?? "");
            payload[field] = trimmed.length === 0 ? null : trimmed;
          } else {
            payload[field] = typeof value === "string" ? value.trim() : value;
          }
        });
        rows.push(payload);
      });
      if (rows.length === 0) {
        return;
      }
      await saveDatasetEdits(selectedSessionId, selectedDataset.name, rows);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Changes saved." });
      setEdits(new Map());
      void queryClient.invalidateQueries({ queryKey: ["session-dataset"] });
    },
    onError: (error) => {
      setStatus({ type: "error", text: getErrorMessage(error, "Failed to save changes.") });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSessionId || selectedRowKeys.size === 0 || !selectedDataset) {
        return;
      }
      const rows = Array.from(selectedRowKeys)
        .map((key) => originalRowMap.get(key))
        .filter((row): row is DatasetRow => Boolean(row))
        .map((row) => {
          const payload: Record<string, unknown> = {};
          datasetPrimaryKey.forEach((column) => {
            if (column === "session_id") {
              payload[column] = selectedSessionId;
            } else {
              payload[column] = row[column];
            }
          });
          if (!("session_id" in payload)) {
            payload.session_id = selectedSessionId;
          }
          return payload;
        });
      if (rows.length === 0) {
        return;
      }
      await deleteDatasetRows(selectedSessionId, selectedDataset.name, rows);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Rows deleted." });
      setSelectedRowKeys(new Set());
      setEdits(new Map());
      void queryClient.invalidateQueries({ queryKey: ["session-dataset"] });
    },
    onError: (error) => {
      setStatus({ type: "error", text: getErrorMessage(error, "Failed to delete rows.") });
    },
  });

  const handleDiscard = () => {
    setLocalRows(originalRows);
    setEdits(new Map());
    setStatus(null);
  };

  const totalRows = tableQuery.data?.total ?? 0;
  const totalPages = totalRows === 0 ? 1 : Math.max(1, Math.ceil(totalRows / pageSize));
  const canEditDataset = Boolean(selectedSessionId && selectedDataset);
  const datasetLabel = selectedDataset?.label ?? "PSI data";
  const datasetDescription =
    selectedDataset?.name === "psi_summary_base"
      ? "PSI summaryデータ"
      : selectedDataset?.name === "psi_base"
      ? "PSI baseデータ"
      : "PSIデータ";

  return (
    <div className="page edits-page">
      <header className="page-header">
        <div>
          <h1>Edits</h1>
          <p>セッションの{datasetDescription}を検索して、画面上で直接編集できます。</p>
        </div>
      </header>

      {status && <div className={`status-message ${status.type}`}>{status.text}</div>}

      <section className="card">
        <h2>Session</h2>
        <div className="form-row">
          <label className="form-field">
            <span>検索</span>
            <input
              type="search"
              value={sessionSearch}
              onChange={(event) => setSessionSearch(event.target.value)}
              placeholder="Search sessions"
            />
          </label>
          <label className="form-field">
            <span>Session</span>
            <select
              value={selectedSessionId}
              onChange={(event) => setSelectedSessionId(event.target.value)}
            >
              <option value="" disabled>
                Select session
              </option>
              {filteredSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {getSessionLabel(session)}
                </option>
              ))}
            </select>
          </label>
        </div>
        {sessionsQuery.isLoading && (
          <p className="session-hint">セッションを読み込み中です…</p>
        )}
        {sessionsQuery.isError && (
          <p className="session-hint session-hint-error">セッションの取得に失敗しました。</p>
        )}
        {showNoSessions && (
          <p className="session-hint">利用可能なセッションがまだありません。</p>
        )}
        {showMissingBaseSessionHint && (
          <p className="session-hint">
            Baseモードのセッションがまだありません。PSI baseデータを編集するには base モードのセッションを作成してください。
          </p>
        )}
      </section>

      {selectedSessionId && datasetsQuery.isLoading && (
        <section className="card">
          <h2>{datasetLabel}</h2>
          <p>Loading dataset metadata…</p>
        </section>
      )}

      {selectedSessionId && datasetsQuery.isError && (
        <section className="card">
          <h2>{datasetLabel}</h2>
          <p className="error-text">Failed to load dataset metadata.</p>
        </section>
      )}

      {selectedSessionId && !datasetsQuery.isLoading && !selectedDataset && (
        <section className="card">
          <h2>PSI data</h2>
          <p>このセッションでは編集可能なPSIデータセットがありません。</p>
        </section>
      )}

      {canEditDataset && selectedDataset && (
        <section className="card">
          <h2>{datasetLabel}</h2>

          <form className="filter-form" onSubmit={handleFilterSubmit}>
            <div className="filter-grid single">
              <label>
                <span>SKU</span>
                <input
                  type="search"
                  value={pendingFilters.sku_code}
                  onChange={(event) => handleFilterChange(event, "sku_code")}
                  placeholder="SKU code"
                />
              </label>
            </div>
            <div className="filter-actions">
              <button type="submit">検索</button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  const defaults = defaultFilters();
                  setPendingFilters(defaults);
                  setTableFilters(defaults);
                  setPage(1);
                  setStatus(null);
                }}
              >
                リセット
              </button>
            </div>
          </form>

          <div className="table-toolbar">
            <div className="table-toolbar-left">
              <span>
                {tableQuery.isLoading
                  ? "Loading rows…"
                  : `Showing ${localRows.length} / ${totalRows} rows`}
              </span>
              <span className="edit-indicator">
                {hasEdits ? "Unsaved changes" : "All changes saved"}
              </span>
            </div>
            <div className="table-toolbar-right">
              <button
                type="button"
                onClick={() => {
                  void saveMutation.mutateAsync();
                }}
                disabled={!hasEdits || saveMutation.isPending}
              >
                {saveMutation.isPending ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                className="secondary"
                onClick={handleDiscard}
                disabled={!hasEdits}
              >
                Discard
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  void deleteMutation.mutateAsync();
                }}
                disabled={selectedRowKeys.size === 0 || deleteMutation.isPending}
              >
                {deleteMutation.isPending ? "Deleting…" : "Delete selected"}
              </button>
            </div>
          </div>

          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th className="select-column">選択</th>
                  {selectedDataset.columns.map((column) => (
                    <th key={column.name}>{column.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableQuery.isLoading && (
                  <tr>
                    <td colSpan={selectedDataset.columns.length + 1}>Loading…</td>
                  </tr>
                )}
                {!tableQuery.isLoading && localRows.length === 0 && (
                  <tr>
                    <td colSpan={selectedDataset.columns.length + 1}>
                      No rows found for the applied filters.
                    </td>
                  </tr>
                )}
                {localRows.map((row) => {
                  const rowKey = getRowKey(row);
                  const isEdited = edits.has(rowKey);
                  const isSelected = selectedRowKeys.has(rowKey);
                  return (
                    <tr key={rowKey} className={isEdited ? "row-edited" : undefined}>
                      <td className="select-column">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={(event) => handleRowSelection(rowKey, event.target.checked)}
                        />
                      </td>
                      {selectedDataset.columns.map((column) => {
                        const cellValue = row[column.name];
                        const displayValue =
                          cellValue === null || cellValue === undefined ? "" : String(cellValue);
                        if (!editableColumns.has(column.name)) {
                          return <td key={column.name}>{displayValue}</td>;
                        }
                        return (
                          <td key={column.name}>
                            <input
                              type={column.type === "number" ? "number" : "text"}
                              value={displayValue}
                              onChange={(event) =>
                                handleCellChange(rowKey, column.name, event.target.value)
                              }
                              maxLength={column.max_length ?? undefined}
                            />
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="pagination">
            <button
              type="button"
              onClick={() => handlePageChange(Math.max(1, page - 1))}
              disabled={page <= 1}
            >
              ‹ Prev
            </button>
            <span>
              Page {page} / {totalPages}
            </span>
            <button
              type="button"
              onClick={() => handlePageChange(Math.min(totalPages, page + 1))}
              disabled={page >= totalPages}
            >
              Next ›
            </button>
            <label className="page-size">
              <span>Rows per page</span>
              <select value={pageSize} onChange={handlePageSizeChange}>
                {PAGE_SIZE_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </section>
      )}
    </div>
  );
}
