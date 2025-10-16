import { useQuery } from "@tanstack/react-query";

import api from "../lib/api";
import type { PSIMetricDefinition } from "../types";
import { orderMetrics } from "../utils/metrics";

export const PSI_METRICS_QUERY_KEY = ["psi-metrics"] as const;

const fetchPSIMetrics = async (): Promise<PSIMetricDefinition[]> => {
  const { data } = await api.get<PSIMetricDefinition[]>("/api/psi-metrics");
  if (!Array.isArray(data)) {
    throw new Error("Unexpected PSI metrics response format.");
  }
  return data;
};

export const usePSIMetricsQuery = () =>
  useQuery({
    queryKey: PSI_METRICS_QUERY_KEY,
    queryFn: fetchPSIMetrics,
    select: orderMetrics,
  });
