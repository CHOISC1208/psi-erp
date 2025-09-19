import { FormEvent, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "../lib/api";
import { Session } from "../types";

interface SessionFormState {
  title: string;
  description?: string;
}

const fetchSessions = async (): Promise<Session[]> => {
  const { data } = await api.get<Session[]>("/sessions");
  return data;
};

export default function SessionsPage() {
  const queryClient = useQueryClient();
  const [formState, setFormState] = useState<SessionFormState>({ title: "", description: "" });

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
  });

  const createSession = useMutation({
    mutationFn: async (payload: SessionFormState) => {
      const { data } = await api.post<Session>("/sessions", {
        title: payload.title,
        description: payload.description?.trim() ? payload.description.trim() : undefined,
      });
      return data;
    },
    onSuccess: () => {
      setFormState({ title: "", description: "" });
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const deleteSession = useMutation({
    mutationFn: async (sessionId: string) => {
      await api.delete(`/sessions/${sessionId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
    },
  });

  const makeLeader = useMutation({
    mutationFn: async (sessionId: string) => {
      const { data } = await api.patch<Session>(`/sessions/${sessionId}/leader`, {});
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["sessions"] });
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
        {createSession.isError && <p className="error">Unable to create session. Try again.</p>}
      </section>

      <section>
        <h2>Existing Sessions</h2>
        {sessionsQuery.isLoading && <p>Loading sessions...</p>}
        {sessionsQuery.isError && <p className="error">Failed to load sessions.</p>}
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
              {sessionsQuery.data.map((session) => (
                <tr key={session.id}>
                  <td>
                    <strong>{session.title}</strong>
                    <br />
                    <small>{new Date(session.created_at).toLocaleString()}</small>
                  </td>
                  <td>{session.description || "—"}</td>
                  <td>{session.is_leader ? "⭐" : ""}</td>
                  <td className="actions">
                    <button
                      type="button"
                      onClick={() => makeLeader.mutate(session.id)}
                      disabled={makeLeader.isPending || session.is_leader}
                    >
                      {session.is_leader ? "Leader" : makeLeader.isPending ? "Updating..." : "Make Leader"}
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteSession.mutate(session.id)}
                      disabled={deleteSession.isPending}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !sessionsQuery.isLoading && <p>No sessions yet.</p>
        )}
      </section>
    </div>
  );
}
