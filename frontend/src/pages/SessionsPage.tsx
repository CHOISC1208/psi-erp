import { ChangeEvent, FormEvent, MouseEvent, useMemo, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import api from "../lib/api";
import { Session, UploadResponse } from "../types";

type DataMode = "base" | "summary";
type ModeFilter = "all" | DataMode;

interface SessionFormState {
  title: string;
  description?: string;
  data_mode: DataMode;
}

interface UploadVariables {
  file: File;
  sessionId: string;
  sessionTitle: string;
  dataMode: DataMode;
}

interface DuplicateKey {
  sku_code: string;
  warehouse_name: string;
  channel: string;
}

const REQUIRED_COLUMNS: Record<DataMode, string[]> = {
  base: [
    "category_1",
    "category_2",
    "category_3",
    "channel",
    "date",
    "fw_rank",
    "gap",
    "inbound_qty",
    "movable_stock",
    "net_flow",
    "outbound_qty",
    "safety_stock",
    "sku_code",
    "ss_rank",
    "stdstock",
    "stock_at_anchor",
    "stock_closing",
    "warehouse_name",
  ],
  summary: [
    "sku_code",
    "warehouse_name",
    "channel",
    "inbound_qty",
    "outbound_qty",
    "std_stock",
    "stock",
  ],
};

const SUMMARY_ALIAS_NOTES = [
  "SKU名 → sku_name",
  "inbound → inbound_qty",
  "outbound → outbound_qty",
];

const MODE_LABELS: Record<DataMode, string> = {
  base: "BASE",
  summary: "SUMMARY",
};

const SAMPLE_LINKS: Record<DataMode, string> = {
  base: "/docs/data/psi_base_sample.csv",
  summary: "/docs/data/psi_summary_sample.csv",
};

const MODE_DESCRIPTIONS: Record<DataMode, string> = {
  base: "Upload day-level PSI data with category, rank, and stock columns.",
  summary: "Upload aggregated SKU × warehouse × channel totals.",
};

const MODE_FILTERS: { value: ModeFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "base", label: "Base" },
  { value: "summary", label: "Summary" },
];

const fetchSessions = async (search: string): Promise<Session[]> => {
  const params = search.trim() ? { search: search.trim() } : undefined;
  const { data } = await api.get<Session[]>("/sessions/", { params });
  return data;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: unknown } | undefined)?.detail;
    if (typeof detail === "string") {
      return detail;
    }
    if (detail && typeof detail === "object" && !Array.isArray(detail) && "message" in detail) {
      const message = (detail as { message?: string }).message;
      if (typeof message === "string") {
        return message;
      }
    }
    if (error.message) {
      return error.message;
    }
  } else if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
};

export default function SessionsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [formState, setFormState] = useState<SessionFormState>({
    title: "",
    description: "",
    data_mode: "base",
  });
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ type: "success" | "error"; text: string } | null>(
    null,
  );
  const [uploadingSessionId, setUploadingSessionId] = useState<string | null>(null);
  const [searchDraft, setSearchDraft] = useState<string>("");
  const [appliedSearch, setAppliedSearch] = useState<string>("");
  const [modeFilter, setModeFilter] = useState<ModeFilter>("all");
  const [uploadDialogSession, setUploadDialogSession] = useState<Session | null>(null);
  const [selectedUploadFile, setSelectedUploadFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadResponse | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [duplicateKeys, setDuplicateKeys] = useState<DuplicateKey[]>([]);

  const sessionsQuery = useQuery({
    queryKey: ["sessions", appliedSearch],
    queryFn: () => fetchSessions(appliedSearch),
  });

  const filteredSessions = useMemo(() => {
    if (!sessionsQuery.data) {
      return [];
    }
    if (modeFilter === "all") {
      return sessionsQuery.data;
    }
    return sessionsQuery.data.filter((session) => session.data_mode === modeFilter);
  }, [modeFilter, sessionsQuery.data]);

  const createSession = useMutation<Session, unknown, SessionFormState>({
    mutationFn: async (payload: SessionFormState) => {
      const { data } = await api.post<Session>("/sessions/", {
        title: payload.title,
        description: payload.description?.trim() ? payload.description.trim() : undefined,
        data_mode: payload.data_mode,
      });
      return data;
    },
    onSuccess: () => {
      setFormState({ title: "", description: "", data_mode: "base" });
      setStatus({ type: "success", text: "Session created successfully." });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      setStatus({ type: "error", text: getErrorMessage(error, "Unable to create session. Try again.") });
    },
    onMutate: () => {
      setStatus(null);
    },
  });

  const deleteSession = useMutation<void, unknown, string>({
    mutationFn: async (sessionId: string) => {
      await api.delete(`/sessions/${sessionId}`);
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Session deleted." });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      setStatus({ type: "error", text: getErrorMessage(error, "Unable to delete session. Try again.") });
    },
    onMutate: () => {
      setStatus(null);
    },
  });

  const makeLeader = useMutation<Session, unknown, string>({
    mutationFn: async (sessionId: string) => {
      const { data } = await api.patch<Session>(`/sessions/${sessionId}/leader`, {});
      return data;
    },
    onSuccess: () => {
      setStatus({ type: "success", text: "Leader updated." });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      setStatus({ type: "error", text: getErrorMessage(error, "Unable to update leader. Try again.") });
    },
    onMutate: () => {
      setStatus(null);
    },
  });

  const uploadMutation = useMutation<
    UploadResponse,
    unknown,
    UploadVariables,
    { sessionTitle: string; dataMode: DataMode }
  >({
    mutationFn: async ({ file, sessionId }: UploadVariables) => {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const { data } = await api.post<UploadResponse>(`/psi/${sessionId}/upload`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        return data;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          const { data } = await api.post<UploadResponse>("/psi/upload", formData, {
            params: sessionId ? { session_id: sessionId } : undefined,
            headers: { "Content-Type": "multipart/form-data" },
          });
          return data;
        }
        throw error;
      }
    },
    onMutate: ({ sessionId, sessionTitle, dataMode }: UploadVariables) => {
      setUploadStatus(null);
      setUploadingSessionId(sessionId);
      setUploadResult(null);
      setUploadError(null);
      setDuplicateKeys([]);
      return { sessionTitle, dataMode };
    },
    onSuccess: (data, _variables, context) => {
      setUploadResult(data);
      setUploadError(null);
      setDuplicateKeys([]);
      setSelectedUploadFile(null);
      const title = context?.sessionTitle ?? "session";
      const label = MODE_LABELS[data.mode];
      setUploadStatus({ type: "success", text: `Uploaded ${data.rows} rows (${label}) for ${title}.` });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
    onError: (error) => {
      setUploadResult(null);
      const detail = axios.isAxiosError(error)
        ? (error.response?.data as { detail?: unknown } | undefined)?.detail
        : undefined;
      if (detail && typeof detail === "object" && !Array.isArray(detail) && "duplicates" in detail) {
        const duplicates = Array.isArray((detail as { duplicates?: unknown }).duplicates)
          ? ((detail as { duplicates: DuplicateKey[] }).duplicates ?? [])
          : [];
        const message =
          typeof (detail as { message?: string }).message === "string"
            ? (detail as { message: string }).message
            : "Duplicate keys detected. Resolve the conflicts and try again.";
        setDuplicateKeys(duplicates);
        setUploadError(message);
        setUploadStatus({ type: "error", text: message });
        return;
      }

      const message = getErrorMessage(error, "Upload failed. Check the CSV file and try again.");
      setUploadError(message);
      setUploadStatus({ type: "error", text: message });
    },
    onSettled: () => {
      setUploadingSessionId(null);
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!formState.title.trim()) return;
    createSession.mutate({
      title: formState.title.trim(),
      description: formState.description,
      data_mode: formState.data_mode,
    });
  };

  const handleDataModeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const value = event.target.value as DataMode;
    setFormState((prev) => ({ ...prev, data_mode: value }));
  };

  const handleOpenUploadDialog = (session: Session) => {
    setUploadDialogSession(session);
    setSelectedUploadFile(null);
    setUploadResult(null);
    setUploadError(null);
    setDuplicateKeys([]);
  };

  const handleUploadDialogClose = () => {
    if (uploadMutation.isPending) {
      return;
    }
    setUploadDialogSession(null);
    setSelectedUploadFile(null);
    setUploadResult(null);
    setUploadError(null);
    setDuplicateKeys([]);
  };

  const handleUploadSubmit = () => {
    if (!uploadDialogSession || !selectedUploadFile) {
      return;
    }
    uploadMutation.mutate({
      file: selectedUploadFile,
      sessionId: uploadDialogSession.id,
      sessionTitle: uploadDialogSession.title,
      dataMode: uploadDialogSession.data_mode,
    });
  };

  const handleOpenPsiTable = (sessionId: string) => {
    const params = new URLSearchParams();
    params.set("sessionId", sessionId);
    navigate({ pathname: "/psi", search: params.toString() });
  };

  const handleApplySearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAppliedSearch(searchDraft.trim());
  };

  const handleResetSearch = () => {
    setSearchDraft("");
    setAppliedSearch("");
  };

  return (
    <div className="page">
      <header>
        <h1>Sessions</h1>
        <p>Create sessions and manage the active leader.</p>
      </header>

      <section>
        <h2>New Session</h2>
        <form onSubmit={handleSubmit} className="form-grid">
          <label>
            Title
            <input
              type="text"
              value={formState.title}
              onChange={(event) => setFormState((prev) => ({ ...prev, title: event.target.value }))}
              required
            />
          </label>
          <label>
            Description
            <input
              type="text"
              value={formState.description ?? ""}
              onChange={(event) => setFormState((prev) => ({ ...prev, description: event.target.value }))}
              placeholder="Optional"
            />
          </label>
          <fieldset className="data-mode-fieldset">
            <legend>Data Mode</legend>
            <label>
              <input
                type="radio"
                name="data-mode"
                value="base"
                checked={formState.data_mode === "base"}
                onChange={handleDataModeChange}
              />
              Base (daily PSI)
            </label>
            <label>
              <input
                type="radio"
                name="data-mode"
                value="summary"
                checked={formState.data_mode === "summary"}
                onChange={handleDataModeChange}
              />
              Summary (aggregated)
            </label>
          </fieldset>
          <button type="submit" disabled={createSession.isPending}>
            {createSession.isPending ? "Saving..." : "Create"}
          </button>
        </form>
      </section>

      <section>
        <h2>Existing Sessions</h2>
        <div className="sessions-toolbar">
          <form className="search-form" onSubmit={handleApplySearch}>
            <label>
              Search
              <input
                type="search"
                value={searchDraft}
                onChange={(event) => setSearchDraft(event.target.value)}
                placeholder="Title, description, or username"
              />
            </label>
            <div className="search-actions">
              <button type="submit">Search</button>
              <button
                type="button"
                className="secondary"
                onClick={handleResetSearch}
                disabled={!searchDraft && !appliedSearch}
              >
                Reset
              </button>
            </div>
          </form>
          <ModeFilterControls value={modeFilter} onChange={setModeFilter} />
        </div>
        {sessionsQuery.isLoading && <p>Loading sessions...</p>}
        {sessionsQuery.isError && (
          <p role="alert" className="error">
            {getErrorMessage(sessionsQuery.error, "Failed to load sessions.")}
          </p>
        )}
        {status && (
          <p role="status" className={status.type === "error" ? "error" : "success"}>
            {status.text}
          </p>
        )}
        {sessionsQuery.data && sessionsQuery.data.length > 0 ? (
          filteredSessions.length > 0 ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Description</th>
                  <th>Mode</th>
                  <th>Created By</th>
                  <th>Updated By</th>
                  <th>Leader</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredSessions.map((session) => {
                  const isMakingLeader = makeLeader.isPending && makeLeader.variables === session.id;
                  const isDeleting = deleteSession.isPending && deleteSession.variables === session.id;
                  const isUploading = uploadMutation.isPending && uploadingSessionId === session.id;

                  return (
                    <tr key={session.id}>
                      <td>
                        <div className="session-title">
                          <strong>{session.title}</strong>
                          <button
                            type="button"
                            className="icon-button"
                            onClick={() => handleOpenPsiTable(session.id)}
                            aria-label={`Open PSI table for ${session.title}`}
                          >
                            ✏️
                          </button>
                        </div>
                      </td>
                      <td>{session.description || "—"}</td>
                      <td>
                        <ModeBadge mode={session.data_mode} />
                      </td>
                      <td>
                        <div>{session.created_by_username ?? "—"}</div>
                        <small>{new Date(session.created_at).toLocaleString()}</small>
                      </td>
                      <td>
                        <div>{session.updated_by_username ?? "—"}</div>
                        <small>{new Date(session.updated_at).toLocaleString()}</small>
                      </td>
                      <td>{session.is_leader ? "⭐" : ""}</td>
                      <td className="actions">
                        <button
                          type="button"
                          onClick={() => makeLeader.mutate(session.id)}
                          disabled={session.is_leader || isMakingLeader}
                        >
                          {session.is_leader
                            ? "Leader"
                            : isMakingLeader
                            ? "Updating..."
                            : "Make Leader"}
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteSession.mutate(session.id)}
                          disabled={isDeleting}
                        >
                          {isDeleting ? "Deleting..." : "Delete"}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenUploadDialog(session)}
                          disabled={isUploading}
                          aria-label={`Upload CSV for ${session.title}`}
                        >
                          {isUploading
                            ? "Uploading..."
                            : `Upload CSV (${MODE_LABELS[session.data_mode]})`}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            !sessionsQuery.isLoading && <p>No sessions match the selected mode.</p>
          )
        ) : (
          !sessionsQuery.isLoading && <p>No sessions yet.</p>
        )}
        {uploadStatus && (
          <p className={uploadStatus.type === "error" ? "error" : "success"}>{uploadStatus.text}</p>
        )}
      </section>

      {uploadDialogSession && (
        <UploadDialog
          session={uploadDialogSession}
          onClose={handleUploadDialogClose}
          selectedFile={selectedUploadFile}
          onFileChange={setSelectedUploadFile}
          onSubmit={handleUploadSubmit}
          isUploading={uploadMutation.isPending}
          error={uploadError}
          result={uploadResult}
          duplicateKeys={duplicateKeys}
        />
      )}
    </div>
  );
}

function ModeBadge({ mode }: { mode: DataMode }) {
  return <span className={`mode-badge mode-badge--${mode}`}>{MODE_LABELS[mode]}</span>;
}

function ModeFilterControls({ value, onChange }: { value: ModeFilter; onChange: (value: ModeFilter) => void }) {
  return (
    <div className="mode-filter" role="group" aria-label="Filter sessions by data mode">
      {MODE_FILTERS.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "active" : undefined}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

interface UploadDialogProps {
  session: Session;
  onClose: () => void;
  selectedFile: File | null;
  onFileChange: (file: File | null) => void;
  onSubmit: () => void;
  isUploading: boolean;
  error: string | null;
  result: UploadResponse | null;
  duplicateKeys: DuplicateKey[];
}

function UploadDialog({
  session,
  onClose,
  selectedFile,
  onFileChange,
  onSubmit,
  isUploading,
  error,
  result,
  duplicateKeys,
}: UploadDialogProps) {
  const requiredColumns = REQUIRED_COLUMNS[session.data_mode];
  const aliasNotes = session.data_mode === "summary" ? SUMMARY_ALIAS_NOTES : [];
  const warnings = result?.warnings ?? [];

  const handleBackdropClick = (event: MouseEvent<HTMLDivElement>) => {
    if (event.target === event.currentTarget && !isUploading) {
      onClose();
    }
  };

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    onFileChange(file);
    event.target.value = "";
  };

  return (
    <div className="upload-dialog-backdrop" role="presentation" onClick={handleBackdropClick}>
      <div
        className="upload-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="upload-dialog-title"
        aria-describedby="upload-dialog-description"
      >
        <header className="upload-dialog__header">
          <div>
            <h3 id="upload-dialog-title">Upload CSV for {session.title}</h3>
            <p id="upload-dialog-description">{MODE_DESCRIPTIONS[session.data_mode]}</p>
          </div>
          <ModeBadge mode={session.data_mode} />
        </header>
        <form
          className="upload-dialog__form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit();
          }}
        >
          <div className="upload-dialog__help">
            <h4>Required columns</h4>
            <RequiredColumnsList columns={requiredColumns} />
            {aliasNotes.length > 0 && (
              <div className="upload-dialog__aliases">
                <p>Alias mappings:</p>
                <ul>
                  {aliasNotes.map((note) => (
                    <li key={note}>{note}</li>
                  ))}
                </ul>
              </div>
            )}
            <a
              href={SAMPLE_LINKS[session.data_mode]}
              target="_blank"
              rel="noopener noreferrer"
              className="upload-dialog__sample"
            >
              Download sample CSV
            </a>
          </div>
          <div className="upload-dialog__file">
            <label className="upload-dialog__file-label">
              <span>Select CSV file</span>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileChange}
                disabled={isUploading}
              />
            </label>
            {selectedFile ? (
              <p className="upload-dialog__file-name">{selectedFile.name}</p>
            ) : (
              <p className="upload-dialog__file-placeholder">No file selected.</p>
            )}
          </div>
          {error && <p className="upload-dialog__status upload-dialog__status--error">{error}</p>}
          {result && (
            <div className="upload-dialog__result" aria-live="polite">
              <h4>Upload summary</h4>
              <p>
                <strong>{result.rows}</strong> rows imported.
              </p>
              {result.dates.length > 0 && (
                <p>Dates affected: {result.dates.join(", ")}</p>
              )}
              {warnings.length > 0 ? (
                <div className="upload-dialog__warnings">
                  <h5>Warnings</h5>
                  <ul>
                    {warnings.map((warning) => (
                      <li key={warning}>{warning}</li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="upload-dialog__no-warnings">No warnings.</p>
              )}
            </div>
          )}
          {duplicateKeys.length > 0 && (
            <div className="upload-dialog__duplicates">
              <h4>Duplicate rows</h4>
              <table>
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Warehouse</th>
                    <th>Channel</th>
                  </tr>
                </thead>
                <tbody>
                  {duplicateKeys.map((key) => (
                    <tr key={`${key.sku_code}-${key.warehouse_name}-${key.channel}`}>
                      <td>{key.sku_code}</td>
                      <td>{key.warehouse_name}</td>
                      <td>{key.channel}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <footer className="upload-dialog__footer">
            <button type="button" className="secondary" onClick={onClose} disabled={isUploading}>
              Close
            </button>
            <button type="submit" disabled={!selectedFile || isUploading}>
              {isUploading ? "Uploading..." : `Upload ${MODE_LABELS[session.data_mode]}`}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}

function RequiredColumnsList({ columns }: { columns: string[] }) {
  return (
    <ul className="upload-dialog__columns">
      {columns.map((column) => (
        <li key={column}>
          <code>{column}</code>
        </li>
      ))}
    </ul>
  );
}
