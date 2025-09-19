import { FormEvent, useState } from "react";
import axios from "axios";
import { useMutation, useQuery } from "@tanstack/react-query";

import { api } from "../lib/api";
import { Session } from "../types";

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

interface UploadResult {
  detail?: string;
}

export default function UploadPage() {
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [message, setMessage] = useState<string | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
  });

  const uploadMutation = useMutation({
    mutationFn: async ({ file, sessionId }: { file: File; sessionId: string }) => {
      const formData = new FormData();
      formData.append("file", file);

      try {
        const { data } = await api.post<UploadResult>(`/psi/${sessionId}/upload`, formData, {
          headers: { "Content-Type": "multipart/form-data" },
        });
        return data;
      } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
          const { data } = await api.post<UploadResult>("/psi/upload", formData, {
            params: sessionId ? { session_id: sessionId } : undefined,
            headers: { "Content-Type": "multipart/form-data" },
          });
          return data;
        }
        throw error;
      }
    },
    onSuccess: () => {
      setMessage("Upload successful.");
    },
    onError: (error) => {
      if (axios.isAxiosError(error)) {
        setMessage(error.response?.data?.detail ?? "Upload failed. Check the CSV file and try again.");
      } else {
        setMessage("Upload failed. Check the CSV file and try again.");
      }
    },
    onMutate: () => {
      setMessage(null);
    },
  });

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fileInput = event.currentTarget.elements.namedItem("file") as HTMLInputElement | null;
    const file = fileInput?.files?.[0];

    if (!file) {
      setMessage("Select a CSV file to upload.");
      return;
    }

    if (!selectedSession) {
      setMessage("Choose a session before uploading.");
      return;
    }

    uploadMutation.mutate({ file, sessionId: selectedSession });
    event.currentTarget.reset();
  };

  return (
    <div className="page">
      <header>
        <h1>Upload PSI CSV</h1>
        <p>Import PSI data into the selected session.</p>
      </header>

      <section>
        <form onSubmit={handleSubmit} className="form-grid">
          <label>
            Session
            <select value={selectedSession} onChange={(event) => setSelectedSession(event.target.value)} required>
              <option value="" disabled>
                Select a session
              </option>
              {sessionsQuery.data?.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title}
                </option>
              ))}
            </select>
          </label>

          <label>
            CSV File
            <input type="file" name="file" accept=".csv,text/csv" required />
          </label>

          <button type="submit" disabled={uploadMutation.isPending || sessionsQuery.isLoading}>
            {uploadMutation.isPending ? "Uploading..." : "Upload"}
          </button>
        </form>

        {sessionsQuery.isLoading && <p>Loading sessions...</p>}
        {sessionsQuery.isError && (
          <p className="error">{getErrorMessage(sessionsQuery.error, "Unable to load sessions.")}</p>
        )}
        {message && <p>{message}</p>}
      </section>
    </div>
  );
}
