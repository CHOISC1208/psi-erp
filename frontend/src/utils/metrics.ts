export const normalizeDisplayOrder = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return null;
    }
    const parsed = Number(trimmed);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
};

export const orderMetrics = <T extends { display_order?: unknown }>(
  metrics: readonly T[],
): Array<T & { display_order: number }> => {
  const normalized = metrics.map((metric, index) => {
    const normalizedOrder = normalizeDisplayOrder(metric.display_order);
    const displayOrder = normalizedOrder ?? Number.MAX_SAFE_INTEGER;
    return {
      metric,
      displayOrder,
      index,
    };
  });

  normalized.sort((a, b) => {
    if (a.displayOrder !== b.displayOrder) {
      return a.displayOrder - b.displayOrder;
    }
    return a.index - b.index;
  });

  return normalized.map(({ metric, displayOrder }) => ({
    ...metric,
    display_order: displayOrder,
  }));
};
