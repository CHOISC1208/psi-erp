import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import api from "../lib/api";
import type { ReallocationPolicy } from "../types";
import { TEST_ALGO_METADATA_KEY } from "./useTestAlgo";

export const REALLOCATION_POLICY_QUERY_KEY = ["reallocation-policy"] as const;

type UpdatePayload = {
  take_from_other_main: boolean;
  rounding_mode: "floor" | "round" | "ceil";
  allow_overfill: boolean;
  updated_by?: string | null;
};

const fetchReallocationPolicy = async (): Promise<ReallocationPolicy> => {
  const { data } = await api.get<ReallocationPolicy>("/api/reallocation-policy");
  return data;
};

const updateReallocationPolicy = async (
  payload: UpdatePayload,
): Promise<ReallocationPolicy> => {
  const { data } = await api.put<ReallocationPolicy>("/api/reallocation-policy", payload);
  return data;
};

export const useReallocationPolicyQuery = () =>
  useQuery({
    queryKey: REALLOCATION_POLICY_QUERY_KEY,
    queryFn: fetchReallocationPolicy,
  });

export const useUpdateReallocationPolicyMutation = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: updateReallocationPolicy,
    onSuccess: (data) => {
      queryClient.setQueryData(REALLOCATION_POLICY_QUERY_KEY, data);
      queryClient.invalidateQueries({ queryKey: ["psi-matrix"] });
      queryClient.invalidateQueries({ queryKey: ["transfer-plans"] });
      queryClient.invalidateQueries({ queryKey: TEST_ALGO_METADATA_KEY });
    },
  });
};
