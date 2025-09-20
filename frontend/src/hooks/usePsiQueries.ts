import { useQuery } from "@tanstack/react-query";

import { api } from "../lib/api";
import { PSIChannel, PSISessionSummary, Session } from "../types";

const fetchSessions = async (): Promise<Session[]> => {
  const { data } = await api.get<Session[]>("/sessions/");
  return data;
};

const fetchDailyPsi = async (
  sessionId: string,
  filters: { sku_code?: string; warehouse_name?: string; channel?: string }
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

const fetchSessionSummary = async (sessionId: string): Promise<PSISessionSummary> => {
  const { data } = await api.get<PSISessionSummary>(`/psi/${sessionId}/summary`);
  return data;
};

export const useSessionsQuery = () =>
  useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
  });

export const useDailyPsiQuery = (
  sessionId: string,
  filters: { sku_code?: string; warehouse_name?: string; channel?: string }
) =>
  useQuery({
    queryKey: ["psi-daily", sessionId, filters.sku_code, filters.warehouse_name, filters.channel],
    queryFn: () => fetchDailyPsi(sessionId, filters),
    enabled: Boolean(sessionId),
  });

export const useSessionSummaryQuery = (sessionId: string) =>
  useQuery({
    queryKey: ["psi-session-summary", sessionId],
    queryFn: () => fetchSessionSummary(sessionId),
    enabled: Boolean(sessionId),
  });
