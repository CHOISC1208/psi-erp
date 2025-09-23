// src/lib/shape.ts
export type SessionApi = {
  id: string; title: string; description: string | null;
  is_leader: boolean; created_by: string | null; updated_by: string | null;
  created_at: string; updated_at: string;
};
export type SessionView = {
  id: string; title: string; description: string | null;
  isLeader: boolean; createdBy: string | null; updatedBy: string | null;
  createdAt: string; updatedAt: string;
};
export const toSessionView = (s: SessionApi): SessionView => ({
  id: s.id,
  title: s.title,
  description: s.description,
  isLeader: s.is_leader,
  createdBy: s.created_by,
  updatedBy: s.updated_by,
  createdAt: s.created_at,
  updatedAt: s.updated_at,
});
