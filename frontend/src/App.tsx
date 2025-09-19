import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api";

interface Session {
  id: string;
  title: string;
  description: string | null;
  is_leader: boolean;
  created_at: string;
  updated_at: string;
}

interface CreateSessionPayload {
  title: string;
  description?: string | null;
}

interface DailyPSIEntry {
  date: string;
  production: number;
  sales: number;
  net_change: number;
  projected_inventory: number;
  reported_inventory: number | null;
}

interface PSIUploadResponse {
  rows_imported: number;
  session_id: string | null;
  dates: string[];
}

const fetchSessions = async (): Promise<Session[]> => {
  const response = await api.get<Session[]>("/sessions/");
  return response.data;
};

const fetchDailyPSI = async (
  sessionId: string | null,
  startDate: string | null,
  endDate: string | null,
  startingInventory: number
): Promise<DailyPSIEntry[]> => {
  const params: Record<string, string> = {};
  if (sessionId) params.session_id = sessionId;
  if (startDate) params.start_date = startDate;
  if (endDate) params.end_date = endDate;
  if (!Number.isNaN(startingInventory)) params.starting_inventory = String(startingInventory);
  const response = await api.get<DailyPSIEntry[]>("/psi/daily", { params });
  return response.data;
};

function formatDate(date: string) {
  return new Date(date).toLocaleDateString();
}

export default function App() {
  const queryClient = useQueryClient();
  const [sessionForm, setSessionForm] = useState<CreateSessionPayload>({ title: "", description: "" });
  const [selectedSession, setSelectedSession] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  const [startingInventory, setStartingInventory] = useState<number>(0);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions
  });

  const dailyQueryKey = useMemo(
    () => ["dailyPsi", selectedSession || null, startDate || null, endDate || null, startingInventory],
    [selectedSession, startDate, endDate, startingInventory]
  );

  const { data: dailyPsi = [], isFetching: dailyLoading } = useQuery({
    queryKey: dailyQueryKey,
    queryFn: () =>
      fetchDailyPSI(selectedSession || null, startDate || null, endDate || null, startingInventory),
  });

  const createSessionMutation = useMutation<Session, unknown, CreateSessionPayload>({
    mutationFn: async (payload: CreateSessionPayload) => {
      const response = await api.post<Session>("/sessions/", payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      setSessionForm({ title: "", description: "" });
    }
  });

  const deleteSessionMutation = useMutation<void, unknown, string>({
    mutationFn: async (sessionId: string) => {
      await api.delete(`/sessions/${sessionId}`);
    },
    onSuccess: (_, sessionId) => {
      if (selectedSession === sessionId) {
        setSelectedSession("");
      }
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
      queryClient.invalidateQueries({ queryKey: ["dailyPsi"] });
    }
  });

  const setLeaderMutation = useMutation<Session, unknown, string>({
    mutationFn: async (sessionId: string) => {
      const response = await api.patch<Session>(`/sessions/${sessionId}/leader`, {});
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    }
  });

  const uploadMutation = useMutation<
    PSIUploadResponse,
    unknown,
    { file: File; sessionId: string | null }
  >({
    mutationFn: async (payload: { file: File; sessionId: string | null }) => {
      const formData = new FormData();
      formData.append("file", payload.file);
      if (payload.sessionId) {
        formData.append("session_id", payload.sessionId);
      }
      const response = await api.post<PSIUploadResponse>("/psi/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" }
      });
      return response.data;
    },
    onSuccess: (result) => {
      setUploadMessage(
        `Imported ${result.rows_imported} rows${result.session_id ? ` for session ${result.session_id}` : ""}.`
      );
      queryClient.invalidateQueries({ queryKey: dailyQueryKey });
    }
  });

  const handleSessionSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!sessionForm.title.trim()) return;
    createSessionMutation.mutate({
      title: sessionForm.title.trim(),
      description: sessionForm.description?.trim() || null
    });
  };

  const handleFileChange = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const fileInput = event.currentTarget.elements.namedItem("csvFile") as HTMLInputElement;
    if (!fileInput?.files?.length) {
      setUploadMessage("Please choose a CSV file to import.");
      return;
    }
    setUploadMessage(null);
    uploadMutation.mutate({ file: fileInput.files[0], sessionId: selectedSession || null });
    fileInput.value = "";
  };

  return (
    <div style={{ margin: "0 auto", maxWidth: "960px", padding: "2rem", fontFamily: "Segoe UI, sans-serif" }}>
      <h1>PSI Mini ERP</h1>

      <section>
        <h2>Create Session</h2>
        <form onSubmit={handleSessionSubmit} style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
          <input
            type="text"
            placeholder="Session title"
            value={sessionForm.title}
            onChange={(e) => setSessionForm((prev) => ({ ...prev, title: e.target.value }))}
            required
          />
          <input
            type="text"
            placeholder="Description"
            value={sessionForm.description ?? ""}
            onChange={(e) => setSessionForm((prev) => ({ ...prev, description: e.target.value }))}
          />
          <button type="submit" disabled={createSessionMutation.isPending}>
            {createSessionMutation.isPending ? "Saving..." : "Add"}
          </button>
        </form>
      </section>

      <section>
        <h2>Sessions</h2>
        {sessionsLoading ? (
          <p>Loading sessions...</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Title</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Leader</th>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id}>
                  <td style={{ padding: "0.5rem 0" }}>
                    <strong>{session.title}</strong>
                    <br />
                    <small>{session.description}</small>
                  </td>
                  <td>{session.is_leader ? "⭐" : ""}</td>
                  <td style={{ display: "flex", gap: "0.5rem" }}>
                    <button type="button" onClick={() => setSelectedSession(session.id)}>
                      Use
                    </button>
                    <button type="button" onClick={() => setLeaderMutation.mutate(session.id)} disabled={session.is_leader}>
                      Set leader
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSessionMutation.mutate(session.id)}
                      disabled={deleteSessionMutation.isPending}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Import PSI CSV</h2>
        <form onSubmit={handleFileChange} style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}>
          <input type="file" name="csvFile" accept=".csv,text/csv" />
          <p style={{ fontSize: "0.9rem", margin: 0 }}>
            CSV headers: date, production, sales, inventory (optional). Date must be YYYY-MM-DD.
          </p>
          <button type="submit" disabled={uploadMutation.isPending}>
            {uploadMutation.isPending ? "Uploading..." : "Upload"}
          </button>
        </form>
        {uploadMessage && <p>{uploadMessage}</p>}
      </section>

      <section>
        <h2>Daily PSI</h2>
        <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap", marginBottom: "1rem" }}>
          <label>
            Session:
            <select value={selectedSession} onChange={(e) => setSelectedSession(e.target.value)}>
              <option value="">All sessions</option>
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title}
                </option>
              ))}
            </select>
          </label>
          <label>
            Start date:
            <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </label>
          <label>
            End date:
            <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </label>
          <label>
            Starting inventory:
            <input
              type="number"
              value={startingInventory}
              onChange={(e) => setStartingInventory(Number(e.target.value))}
            />
          </label>
        </div>
        {dailyLoading ? (
          <p>Computing daily PSI...</p>
        ) : dailyPsi.length === 0 ? (
          <p>No PSI data available.</p>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", borderBottom: "1px solid #ccc" }}>Date</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}>Production</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}>Sales</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}>Net</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}>Projected inventory</th>
                <th style={{ textAlign: "right", borderBottom: "1px solid #ccc" }}>Reported inventory</th>
              </tr>
            </thead>
            <tbody>
              {dailyPsi.map((entry) => (
                <tr key={entry.date}>
                  <td style={{ padding: "0.5rem 0" }}>{formatDate(entry.date)}</td>
                  <td style={{ textAlign: "right" }}>{entry.production.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>{entry.sales.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>{entry.net_change.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>{entry.projected_inventory.toFixed(2)}</td>
                  <td style={{ textAlign: "right" }}>
                    {entry.reported_inventory != null ? entry.reported_inventory.toFixed(2) : "-"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
