import { useMutation, useQuery } from "@tanstack/react-query";

import api from "../lib/api";
import {
  ChannelTransfer,
  ChannelTransferCreate,
  ChannelTransferIdentifier,
  PSIChannel,
  PSISessionSummary,
  PSIReportResponse,
  Session,
} from "../types";

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

const generatePsiReport = async ({
  sessionId,
  skuCode,
}: {
  sessionId: string;
  skuCode: string;
}): Promise<PSIReportResponse> => {
  const { data } = await api.get<PSIReportResponse>(`/psi/${sessionId}/report`, {
    params: { sku_code: skuCode },
  });
  return data;
};

const fetchChannelTransfers = async (sessionId: string): Promise<ChannelTransfer[]> => {
  if (!sessionId) {
    return [];
  }
  const { data } = await api.get<ChannelTransfer[]>("/channel-transfers/", {
    params: { session_id: sessionId },
  });
  return data;
};

const createChannelTransfer = async (
  payload: ChannelTransferCreate
): Promise<ChannelTransfer> => {
  const { data } = await api.post<ChannelTransfer>("/channel-transfers/", payload);
  return data;
};

const deleteChannelTransfer = async (
  identifier: ChannelTransferIdentifier
): Promise<void> => {
  const { session_id, sku_code, warehouse_name, transfer_date, from_channel, to_channel } = identifier;
  await api.delete(
    `/channel-transfers/${encodeURIComponent(session_id)}/${encodeURIComponent(
      sku_code
    )}/${encodeURIComponent(warehouse_name)}/${encodeURIComponent(transfer_date)}/${encodeURIComponent(
      from_channel
    )}/${encodeURIComponent(to_channel)}`
  );
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

export const channelTransfersQueryKey = (sessionId: string) => [
  "channel-transfers",
  sessionId,
];

export const useChannelTransfersQuery = (sessionId: string) =>
  useQuery({
    queryKey: channelTransfersQueryKey(sessionId),
    queryFn: () => fetchChannelTransfers(sessionId),
    enabled: Boolean(sessionId),
  });

export const useCreateChannelTransferMutation = () =>
  useMutation({
    mutationFn: createChannelTransfer,
  });

export const useDeleteChannelTransferMutation = () =>
  useMutation({
    mutationFn: deleteChannelTransfer,
  });

export const usePsiReportMutation = () =>
  useMutation({
    mutationFn: generatePsiReport,
  });
