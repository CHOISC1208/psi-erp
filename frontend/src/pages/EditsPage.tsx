import {
  ChangeEvent,
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";

import api from "../lib/api";
import { useSessionsQuery } from "../hooks/usePsiQueries";
import type {
  PsiBaseImportResponse,
  PsiBasePage,
  PsiBaseRecord,
  Session,
  SessionDatasetMetadata,
} from "../types";

type StatusMessage = { type: "success" | "error"; text: string };

interface PsiBaseFilters {
  sku_code: string;
  warehouse_name: string;
  channel: string;
  fw_rank: string;
  ss_rank: string;
  date_start: string;
  date_end: string;
}

const defaultFilters = (): PsiBaseFilters => ({
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

const makeRowKey = (row: Pick<PsiBaseRecord, "sku_code" | "warehouse_name" | "channel" | "date">) =>
  [row.sku_code, row.warehouse_name, row.channel, row.date].join(
    ROW_KEY_DELIMITER,
  );

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

const fetchPsiBasePage = async (
  sessionId: string,
  filters: Record<string, string>,
  page: number,
  size: number,
): Promise<PsiBasePage> => {
  const params: Record<string, string> = {
    page: String(page),
    size: String(size),
  };
  if (Object.keys(filters).length > 0) {
    params.filters = JSON.stringify(filters);
  }
  const { data } = await api.get<PsiBasePage>(
    `/sessions/${sessionId}/psi_base`,
    { params },
  );
  return data;
};

const savePsiBaseEdits = async (
  sessionId: string,
  rows: Record<string, unknown>[],
) => {
  await api.patch(`/sessions/${sessionId}/psi_base`, { rows });
};

const deletePsiBaseRows = async (
  sessionId: string,
  rows: Pick<PsiBaseRecord, "session_id" | "sku_code" | "warehouse_name" | "channel" | "date">[],
) => {
  await api.delete(`/sessions/${sessionId}/psi_base`, { data: { rows } });
};

const exportPsiBase = async (
  sessionId: string,
  filters: Record<string, string>,
  includeAll: boolean,
  page: number,
  size: number,
) => {
  const params: Record<string, string> = {
    all: includeAll ? "true" : "false",
    page: String(page),
    size: String(size),
  };
  if (Object.keys(filters).length > 0) {
    params.filters = JSON.stringify(filters);
  }
  const response = await api.get<Blob>(
    `/sessions/${sessionId}/psi_base/export`,
    {
      params,
      responseType: "blob",
    },
  );
  return response;
};

const downloadTemplate = async (sessionId: string) => {
  const response = await api.get<Blob>(
    `/sessions/${sessionId}/psi_base/template`,
    { responseType: "blob" },
  );
  return response;
};

const importPsiBase = async (
  sessionId: string,
  mode: "replace" | "upsert",
  file: File,
): Promise<PsiBaseImportResponse> => {
  const formData = new FormData();
  formData.append("file", file);
  const { data } = await api.post<PsiBaseImportResponse>(
    `/sessions/${sessionId}/psi_base/import`,
    formData,
    {
      params: { mode },
      headers: { "Content-Type": "multipart/form-data" },
    },
  );
  return data;
};

const sanitizeFilters = (filters: PsiBaseFilters): Record<string, string> => {
  const entries = Object.entries(filters)
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
  const [selectedDatasetName, setSelectedDatasetName] = useState<string>("");
  const [activeTab, setActiveTab] = useState<"table" | "csv">("table");
  const [tableFilters, setTableFilters] = useState<PsiBaseFilters>(defaultFilters);
  const [pendingFilters, setPendingFilters] = useState<PsiBaseFilters>(defaultFilters);
  const [pageSize, setPageSize] = useState<number>(50);
  const [page, setPage] = useState<number>(1);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [importMode, setImportMode] = useState<"replace" | "upsert">("replace");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importResult, setImportResult] = useState<PsiBaseImportResponse | null>(null);

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
  }, [sessionSearch, sessions]);

  useEffect(() => {
    if (!selectedSessionId && filteredSessions.length > 0) {
      setSelectedSessionId(filteredSessions[0].id);
    }
  }, [filteredSessions, selectedSessionId]);

  useEffect(() => {
    setSelectedDatasetName("");
    setTableFilters(defaultFilters());
    setPendingFilters(defaultFilters());
    setPage(1);
    setStatus(null);
    setImportFile(null);
    setImportResult(null);
  }, [selectedSessionId]);

  const datasetsQuery = useQuery({
    queryKey: ["session-datasets", selectedSessionId],
    queryFn: () => fetchDatasets(selectedSessionId),
    enabled: Boolean(selectedSessionId),
  });

  const datasets = datasetsQuery.data ?? [];

  useEffect(() => {
    if (datasets.length === 0) {
      setSelectedDatasetName("");
      return;
    }
    if (!selectedDatasetName) {
      setSelectedDatasetName(datasets[0].name);
      return;
    }
    const exists = datasets.some((dataset) => dataset.name === selectedDatasetName);
    if (!exists) {
      setSelectedDatasetName(datasets[0].name);
    }
  }, [datasets, selectedDatasetName]);

  const selectedDataset = useMemo(
    () => datasets.find((dataset) => dataset.name === selectedDatasetName) ?? null,
    [datasets, selectedDatasetName],
  );

  const sanitizedFilters = useMemo(
    () => sanitizeFilters(tableFilters),
    [tableFilters],
  );

  const tableQuery = useQuery({
    queryKey: [
      "session-psi-base",
      selectedSessionId,
      selectedDataset?.name,
      sanitizedFilters.sku_code ?? "",
      sanitizedFilters.warehouse_name ?? "",
      sanitizedFilters.channel ?? "",
      sanitizedFilters.fw_rank ?? "",
      sanitizedFilters.ss_rank ?? "",
      sanitizedFilters.date_start ?? "",
      sanitizedFilters.date_end ?? "",
      page,
      pageSize,
    ],
    queryFn: () =>
      fetchPsiBasePage(selectedSessionId, sanitizedFilters, page, pageSize),
    enabled:
      Boolean(selectedSessionId) && selectedDataset?.name === "psi_base",
    placeholderData: (previous) => previous ?? undefined,
  });

  const originalRows = tableQuery.data?.rows ?? [];
  const originalRowMap = useMemo(() => {
    const map = new Map<string, PsiBaseRecord>();
    originalRows.forEach((row) => {
      map.set(makeRowKey(row), row);
    });
    return map;
  }, [originalRows]);

  const [localRows, setLocalRows] = useState<PsiBaseRecord[]>([]);
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
    field: keyof PsiBaseFilters,
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
        makeRowKey(row) === rowKey ? { ...row, [field]: value } : row,
      ),
    );
    setEdits((prev) => {
      const next = new Map(prev);
      const original = originalRowMap.get(rowKey);
      const base = next.get(rowKey) ?? {};
      const normalizedValue = value;
      const originalValue = original
        ? (original[field as keyof PsiBaseRecord] ?? "")
        : "";
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
      if (!selectedSessionId || edits.size === 0) {
        return;
      }
      const rows: Record<string, unknown>[] = [];
      edits.forEach((changes, key) => {
        const original = originalRowMap.get(key);
        if (!original) {
          return;
        }
        const payload: Record<string, unknown> = {
          session_id: selectedSessionId,
          sku_code: original.sku_code,
          warehouse_name: original.warehouse_name,
          channel: original.channel,
          date: original.date,
        };
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
      await savePsiBaseEdits(selectedSessionId, rows);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Changes saved." });
      setEdits(new Map());
      void queryClient.invalidateQueries({ queryKey: ["session-psi-base"] });
    },
    onError: (error) => {
      setStatus({ type: "error", text: getErrorMessage(error, "Failed to save changes.") });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSessionId || selectedRowKeys.size === 0) {
        return;
      }
      const rows = Array.from(selectedRowKeys)
        .map((key) => originalRowMap.get(key))
        .filter((row): row is PsiBaseRecord => Boolean(row))
        .map((row) => ({
          session_id: selectedSessionId,
          sku_code: row.sku_code,
          warehouse_name: row.warehouse_name,
          channel: row.channel,
          date: row.date,
        }));
      if (rows.length === 0) {
        return;
      }
      await deletePsiBaseRows(selectedSessionId, rows);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Rows deleted." });
      setSelectedRowKeys(new Set());
      setEdits(new Map());
      void queryClient.invalidateQueries({ queryKey: ["session-psi-base"] });
    },
    onError: (error) => {
      setStatus({ type: "error", text: getErrorMessage(error, "Failed to delete rows.") });
    },
  });

  const importMutation = useMutation({
    mutationFn: async () => {
      if (!selectedSessionId || !importFile) {
        throw new Error("ファイルを選択してください");
      }
      return importPsiBase(selectedSessionId, importMode, importFile);
    },
    onSuccess: (result) => {
      setImportResult(result);
      setImportFile(null);
      setStatus({
        type: "success",
        text: `Import completed. Added ${result.added}, updated ${result.updated}, deleted ${result.deleted}.`,
      });
      void queryClient.invalidateQueries({ queryKey: ["session-psi-base"] });
    },
    onError: (error) => {
      setStatus({ type: "error", text: getErrorMessage(error, "Failed to import CSV.") });
    },
  });

  const handleDiscard = () => {
    setLocalRows(originalRows);
    setEdits(new Map());
    setStatus(null);
  };

  const handleDownloadCsv = async (includeAll: boolean) => {
    if (!selectedSessionId) {
      return;
    }
    try {
      const response = await exportPsiBase(
        selectedSessionId,
        sanitizedFilters,
        includeAll,
        page,
        pageSize,
      );
      const blob = new Blob(["\ufeff", response.data], {
        type: response.headers["content-type"] ?? "text/csv;charset=utf-8",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      const disposition = response.headers["content-disposition"];
      const match =
        typeof disposition === "string"
          ? disposition.match(/filename="?([^";]+)"?/i)
          : null;
      link.download = match?.[1] ?? `psi-base-${selectedSessionId}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
      setStatus({ type: "success", text: "CSV download started." });
    } catch (error) {
      setStatus({ type: "error", text: getErrorMessage(error, "Failed to download CSV.") });
    }
  };

  const handleDownloadTemplate = async () => {
    if (!selectedSessionId) {
      return;
    }
    try {
      const response = await downloadTemplate(selectedSessionId);
      const blob = new Blob(["\ufeff", response.data], {
        type: response.headers["content-type"] ?? "text/csv;charset=utf-8",
      });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `psi-base-template-${selectedSessionId}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setStatus({ type: "error", text: getErrorMessage(error, "Failed to download template.") });
    }
  };

  const handleImportSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    setImportResult(null);
    try {
      await importMutation.mutateAsync();
    } catch (error) {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Failed to import CSV."),
      });
    }
  };

  const totalRows = tableQuery.data?.total ?? 0;
  const totalPages = totalRows === 0 ? 1 : Math.max(1, Math.ceil(totalRows / pageSize));

  return (
    <div className="page transfer-page">
      <header className="page-header">
        <div>
          <h1>Edits</h1>
          <p>Manage session scoped PSI datasets with inline edits or CSV uploads.</p>
        </div>
        <a
          className="button"
          href="/reallocation"
          target="_blank"
          rel="noopener noreferrer"
        >
          Reallocationへ
        </a>
      </header>

      {status && <div className={`status-message ${status.type}`}>{status.text}</div>}

      <section className="card">
        <h2>Step 1: Select session</h2>
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
      </section>

      <section className="card">
        <h2>Step 2: Choose dataset</h2>
        {datasetsQuery.isLoading && <p>Loading datasets…</p>}
        {datasetsQuery.isError && <p className="error-text">Failed to load dataset list.</p>}
        {datasets.length === 0 && !datasetsQuery.isLoading && (
          <p>No editable datasets are configured for this session.</p>
        )}
        {datasets.length > 0 && (
          <div className="dataset-selector">
            {datasets.map((dataset) => (
              <label key={dataset.name} className="dataset-option">
                <input
                  type="radio"
                  name="dataset"
                  value={dataset.name}
                  checked={dataset.name === selectedDatasetName}
                  onChange={(event) => setSelectedDatasetName(event.target.value)}
                />
                <span className="dataset-label">{dataset.label}</span>
                {dataset.description && (
                  <span className="dataset-description">{dataset.description}</span>
                )}
              </label>
            ))}
          </div>
        )}
      </section>

      {selectedDataset?.name === "psi_base" && (
        <section className="card">
          <h2>Step 3: Edit data</h2>
          <div className="tab-header">
            <button
              type="button"
              className={activeTab === "table" ? "active" : ""}
              onClick={() => setActiveTab("table")}
            >
              Table editor
            </button>
            <button
              type="button"
              className={activeTab === "csv" ? "active" : ""}
              onClick={() => setActiveTab("csv")}
            >
              CSV import/export
            </button>
          </div>

          {activeTab === "table" && (
            <div className="tab-panel">
              <form className="filter-form" onSubmit={handleFilterSubmit}>
                <div className="filter-grid">
                  <label>
                    <span>SKU</span>
                    <input
                      type="search"
                      value={pendingFilters.sku_code}
                      onChange={(event) => handleFilterChange(event, "sku_code")}
                      placeholder="SKU code"
                    />
                  </label>
                  <label>
                    <span>Warehouse</span>
                    <input
                      type="search"
                      value={pendingFilters.warehouse_name}
                      onChange={(event) => handleFilterChange(event, "warehouse_name")}
                      placeholder="Warehouse"
                    />
                  </label>
                  <label>
                    <span>Channel</span>
                    <input
                      type="search"
                      value={pendingFilters.channel}
                      onChange={(event) => handleFilterChange(event, "channel")}
                      placeholder="Channel"
                    />
                  </label>
                  <label>
                    <span>FW rank</span>
                    <input
                      type="search"
                      value={pendingFilters.fw_rank}
                      onChange={(event) => handleFilterChange(event, "fw_rank")}
                      placeholder="FW"
                    />
                  </label>
                  <label>
                    <span>SS rank</span>
                    <input
                      type="search"
                      value={pendingFilters.ss_rank}
                      onChange={(event) => handleFilterChange(event, "ss_rank")}
                      placeholder="SS"
                    />
                  </label>
                  <label>
                    <span>Date start</span>
                    <input
                      type="date"
                      value={pendingFilters.date_start}
                      onChange={(event) => handleFilterChange(event, "date_start")}
                    />
                  </label>
                  <label>
                    <span>Date end</span>
                    <input
                      type="date"
                      value={pendingFilters.date_end}
                      onChange={(event) => handleFilterChange(event, "date_end")}
                    />
                  </label>
                </div>
                <div className="filter-actions">
                  <button type="submit">Apply filters</button>
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
                    Reset
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
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => handleDownloadCsv(false)}
                    disabled={tableQuery.isLoading}
                  >
                    CSV (current page)
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => handleDownloadCsv(true)}
                    disabled={tableQuery.isLoading}
                  >
                    CSV (all results)
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
                      const rowKey = makeRowKey(row);
                      const isEdited = edits.has(rowKey);
                      const isSelected = selectedRowKeys.has(rowKey);
                      return (
                        <tr key={rowKey} className={isEdited ? "row-edited" : undefined}>
                          <td className="select-column">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(event) =>
                                handleRowSelection(rowKey, event.target.checked)
                              }
                            />
                          </td>
                      {selectedDataset.columns.map((column) => {
                        const cellValue = row[column.name as keyof PsiBaseRecord];
                        const displayValue =
                          cellValue === null || cellValue === undefined
                            ? ""
                            : String(cellValue);
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
            </div>
          )}

          {activeTab === "csv" && (
            <div className="tab-panel csv-panel">
              <div className="csv-actions">
                <button type="button" onClick={handleDownloadTemplate}>
                  Download template
                </button>
                <button
                  type="button"
                  className="secondary"
                  onClick={() => handleDownloadCsv(true)}
                >
                  Export current dataset
                </button>
              </div>
              <form className="import-form" onSubmit={handleImportSubmit}>
                <label className="form-field">
                  <span>CSV file</span>
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={(event) => {
                      const [file] = event.target.files ?? [];
                      setImportFile(file ?? null);
                    }}
                  />
                </label>
                <div className="form-field">
                  <span>Import mode</span>
                  <label className="radio">
                    <input
                      type="radio"
                      name="import-mode"
                      value="replace"
                      checked={importMode === "replace"}
                      onChange={() => setImportMode("replace")}
                    />
                    <span>Replace (truncate and reload)</span>
                  </label>
                  <label className="radio">
                    <input
                      type="radio"
                      name="import-mode"
                      value="upsert"
                      checked={importMode === "upsert"}
                      onChange={() => setImportMode("upsert")}
                    />
                    <span>Upsert (update existing, insert new)</span>
                  </label>
                </div>
                <button type="submit" disabled={!importFile || importMutation.isPending}>
                  {importMutation.isPending ? "Importing…" : "Run import"}
                </button>
              </form>
              {importResult && (
                <div className="import-summary">
                  <h3>Last import summary</h3>
                  <ul>
                    <li>Added: {importResult.added}</li>
                    <li>Updated: {importResult.updated}</li>
                    <li>Deleted: {importResult.deleted}</li>
                  </ul>
                  {importResult.warnings.length > 0 && (
                    <details>
                      <summary>Warnings</summary>
                      <ul>
                        {importResult.warnings.map((warning, index) => (
                          <li key={index}>{warning}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </div>
              )}
            </div>
          )}
        </section>
      )}
    </div>
  );
}
