// src/lib/shape.ts
export type SessionApi = {
  id: string; title: string; description: string | null;
  is_leader: boolean; created_at: string; updated_at: string;
};
export type SessionView = {
  id: string; title: string; description: string | null;
  isLeader: boolean; createdAt: string; updatedAt: string;
};
export const toSessionView = (s: SessionApi): SessionView => ({
  id: s.id,
  title: s.title,
  description: s.description,
  isLeader: s.is_leader,
  createdAt: s.created_at,
  updatedAt: s.updated_at,
});
