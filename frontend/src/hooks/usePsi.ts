import { useQuery } from "@tanstack/react-query";

import { api } from "../lib/api";
import {
  PSIChannel,
  PSIEditApplyResult,
  PSIEditUpdatePayload,
  PSISessionSummary,
  Session,
} from "../types";

export type PsiFilters = {
  sku_code?: string;
  warehouse_name?: string;
  channel?: string;
};

export const fetchSessions = async (): Promise<Session[]> => {
  const { data } = await api.get<Session[]>("/sessions/");
  return data;
};

export const fetchDailyPsi = async (
  sessionId: string,
  filters: PsiFilters
): Promise<PSIChannel[]> => {
  const params: Record<string, string> = {};
  if (filters.sku_code?.trim()) params.sku_code = filters.sku_code.trim();
  if (filters.warehouse_name?.trim()) params.warehouse_name = filters.warehouse_name.trim();
  if (filters.channel?.trim()) params.channel = filters.channel.trim();

  const { data } = await api.get<PSIChannel[]>(`/psi/${sessionId}/daily`, {
    params,
  });
  return data;
};

export const fetchSessionSummary = async (
  sessionId: string
): Promise<PSISessionSummary> => {
  const { data } = await api.get<PSISessionSummary>(`/psi/${sessionId}/summary`);
  return data;
};

export const applyPsiEdits = async (
  sessionId: string,
  edits: PSIEditUpdatePayload[]
): Promise<PSIEditApplyResult> => {
  const { data } = await api.post<PSIEditApplyResult>(`/psi/${sessionId}/edits/apply`, { edits });
  return data;
};

export const useSessionsQuery = () =>
  useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
  });

export const useDailyPsiQuery = (
  sessionId: string,
  filters: PsiFilters
) =>
  useQuery({
    queryKey: [
      "psi-daily",
      sessionId,
      filters.sku_code,
      filters.warehouse_name,
      filters.channel,
    ],
    queryFn: () => fetchDailyPsi(sessionId, filters),
    enabled: Boolean(sessionId),
  });

export const useSessionSummaryQuery = (sessionId: string) =>
  useQuery({
    queryKey: ["psi-session-summary", sessionId],
    queryFn: () => fetchSessionSummary(sessionId),
    enabled: Boolean(sessionId),
  });
