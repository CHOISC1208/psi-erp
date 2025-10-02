import { useMutation, useQuery } from "@tanstack/react-query";

import api from "../lib/api";
import type {
  TestAlgoMetadata,
  TestAlgoRunRequest,
  TestAlgoRunResponse,
} from "../types";

export const TEST_ALGO_METADATA_KEY = ["test-algo", "metadata"] as const;

export function useTestAlgoMetadata() {
  return useQuery({
    queryKey: TEST_ALGO_METADATA_KEY,
    queryFn: async () => {
      const { data } = await api.get<TestAlgoMetadata>("/api/test-algo/metadata");
      return data;
    },
  });
}

export function useTestAlgoRunMutation() {
  return useMutation({
    mutationFn: async (payload: TestAlgoRunRequest) => {
      const { data } = await api.post<TestAlgoRunResponse>("/api/test-algo/run", payload);
      return data;
    },
  });
}
