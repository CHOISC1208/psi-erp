import { useMutation, useQuery } from "@tanstack/react-query";

import api from "../lib/api";
import type { MatrixRow, TransferPlan, TransferPlanLine } from "../types";

export interface MatrixQueryArgs {
  sessionId: string;
  start: string;
  end: string;
  planId?: string | null;
  skuCodes?: string[];
}

export interface TransferPlanLineWrite {
  line_id?: string;
  plan_id?: string;
  sku_code: string;
  from_warehouse: string;
  from_channel: string;
  to_warehouse: string;
  to_channel: string;
  qty: number;
  is_manual: boolean;
  reason?: string | null;
}

export interface TransferPlanRecommendResponse {
  plan: TransferPlan;
  lines: TransferPlanLine[];
}

const buildMatrixParams = (args: MatrixQueryArgs) => {
  const params = new URLSearchParams();
  params.set("session_id", args.sessionId);
  params.set("start", args.start);
  params.set("end", args.end);
  if (args.planId) {
    params.set("plan_id", args.planId);
  }
  args.skuCodes?.forEach((code) => {
    if (code.trim()) {
      params.append("sku_codes", code.trim());
    }
  });
  return params;
};

const fetchMatrix = async (args: MatrixQueryArgs): Promise<MatrixRow[]> => {
  const params = buildMatrixParams(args);
  const { data } = await api.get<MatrixRow[]>("/api/psi/matrix", { params });
  return data;
};

export const useMatrixQuery = (args: MatrixQueryArgs | null) =>
  useQuery({
    queryKey: args
      ? [
          "psi-matrix",
          args.sessionId,
          args.start,
          args.end,
          args.planId ?? "",
          (args.skuCodes ?? []).join("|"),
        ]
      : ["psi-matrix", "idle"],
    queryFn: () => fetchMatrix(args as MatrixQueryArgs),
    enabled: Boolean(args?.sessionId && args?.start && args?.end),
  });

const recommendPlan = async (
  payload: Omit<MatrixQueryArgs, "planId"> & {
    skuCodes?: string[];
  },
): Promise<TransferPlanRecommendResponse> => {
  const body = {
    session_id: payload.sessionId,
    start: payload.start,
    end: payload.end,
    sku_codes: payload.skuCodes,
  };
  const { data } = await api.post<TransferPlanRecommendResponse>(
    "/api/transfer-plans/recommend",
    body,
  );
  return data;
};

export const useRecommendPlanMutation = () =>
  useMutation({
    mutationFn: recommendPlan,
  });

const savePlanLines = async ({
  planId,
  lines,
}: {
  planId: string;
  lines: TransferPlanLineWrite[];
}): Promise<void> => {
  await api.put(`/api/transfer-plans/${encodeURIComponent(planId)}/lines`, {
    lines,
  });
};

export const useSavePlanLinesMutation = () =>
  useMutation({
    mutationFn: savePlanLines,
  });
