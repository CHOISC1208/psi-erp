import { ChangeEvent, FormEvent, useRef, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import api from "../lib/api";
import { Session } from "../types";

interface SessionFormState {
  title: string;
  description?: string;
}

interface UploadVariables {
  file: File;
  sessionId: string;
  sessionTitle: string;
}

const fetchSessions = async (): Promise<Session[]> => {
  const { data } = await api.get<Session[]>("/sessions/");
  return data;
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

export default function SessionsPage() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [formState, setFormState] = useState<SessionFormState>({ title: "", description: "" });
  const [status, setStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [uploadStatus, setUploadStatus] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [uploadingSessionId, setUploadingSessionId] = useState<string | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
  });

  const createSession = useMutation<Session, unknown, SessionFormState>({
    mutationFn: async (payload: SessionFormState) => {
      const { data } = await api.post<Session>("/sessions/", {
        title: payload.title,
        description: payload.description?.trim() ? payload.description.trim() : undefined,
      });
      return data;
    },
    onSuccess: () => {
      setFormState({ title: "", description: "" });
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
    unknown,
    unknown,
    UploadVariables,
    { sessionTitle: string }
  >({
    mutationFn: async ({ file, sessionId }: UploadVariables) => {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const { data } = await api.post(`/psi/${sessionId}/upload`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        return data;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          const { data } = await api.post("/psi/upload", formData, {
            params: sessionId ? { session_id: sessionId } : undefined,
            headers: { "Content-Type": "multipart/form-data" },
          });
          return data;
        }
        throw error;
      }
    },
    onMutate: ({ sessionId, sessionTitle }: UploadVariables) => {
      setUploadStatus(null);
      setUploadingSessionId(sessionId);
      return { sessionTitle };
    },
    onSuccess: (_data, _variables, context) => {
      if (context?.sessionTitle) {
        setUploadStatus({ type: "success", text: `Uploaded CSV for ${context.sessionTitle}.` });
      } else {
        setUploadStatus({ type: "success", text: "Upload completed." });
      }
    },
    onError: (error) => {
      setUploadStatus({
        type: "error",
        text: getErrorMessage(error, "Upload failed. Check the CSV file and try again."),
      });
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
    });
  };

  const handleUploadForSession = (sessionId: string, sessionTitle: string, file: File | null) => {
    if (!file) {
      return;
    }

    uploadMutation.mutate({ file, sessionId, sessionTitle });
  };

  const handleOpenPsiTable = (sessionId: string) => {
    const params = new URLSearchParams();
    params.set("sessionId", sessionId);
    navigate({ pathname: "/psi", search: params.toString() });
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
          <button type="submit" disabled={createSession.isPending}>
            {createSession.isPending ? "Saving..." : "Create"}
          </button>
        </form>
      </section>

      <section>
        <h2>Existing Sessions</h2>
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
          <table className="table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Description</th>
                <th>Leader</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessionsQuery.data.map((session) => {
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
                      <br />
                      <small>{new Date(session.created_at).toLocaleString()}</small>
                    </td>
                    <td>{session.description || "—"}</td>
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
                      <CSVUploadButton
                        isUploading={isUploading}
                        onFileSelected={(file) => handleUploadForSession(session.id, session.title, file)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          !sessionsQuery.isLoading && <p>No sessions yet.</p>
        )}
        {uploadStatus && (
          <p className={uploadStatus.type === "error" ? "error" : "success"}>{uploadStatus.text}</p>
        )}
      </section>
    </div>
  );
}

interface CSVUploadButtonProps {
  onFileSelected: (file: File | null) => void;
  isUploading: boolean;
}

function CSVUploadButton({ onFileSelected, isUploading }: CSVUploadButtonProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    onFileSelected(file);
    event.target.value = "";
  };

  const handleButtonClick = () => {
    inputRef.current?.click();
  };

  return (
    <>
      <input
        type="file"
        accept=".csv,text/csv"
        className="visually-hidden"
        ref={inputRef}
        onChange={handleInputChange}
      />
      <button type="button" onClick={handleButtonClick} disabled={isUploading} aria-label="Upload CSV">
        {isUploading ? "Uploading..." : "Upload CSV"}
      </button>
    </>
  );
}
