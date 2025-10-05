import { FormEvent, useCallback, useEffect, useId, useMemo, useState } from "react";
import axios from "axios";

import {
  useMatrixQuery,
  useRecommendPlanMutation,
  useSavePlanLinesMutation,
  useTransferPlanDetailMutation,
  useTransferPlansQuery,
  type MatrixQueryArgs,
  type TransferPlanLineWrite,
} from "../hooks/useTransferPlans";
import { useSessionsQuery, useSessionSummaryQuery, useDailyPsiQuery } from "../hooks/usePsiQueries";
import type { MatrixRow, TransferPlan, TransferPlanLine } from "../types";
import { PSIMatrixTabs } from "../features/reallocation/psi/PSIMatrixTabs";

interface StatusMessage {
  type: "success" | "error";
  text: string;
}

interface LineDraft {
  line_id: string;
  plan_id: string;
  sku_code: string;
  from_warehouse: string;
  from_channel: string;
  to_warehouse: string;
  to_channel: string;
  qty: string;
  is_manual: boolean;
  reason: string;
}

const getErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail;
    if (typeof detail === "string" && detail.trim().length > 0) {
      return detail;
    }
    if (error.message) {
      return error.message;
    }
  } else if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
};

const toDraftLine = (line: TransferPlanLine): LineDraft => ({
  line_id: line.line_id,
  plan_id: line.plan_id,
  sku_code: line.sku_code,
  from_warehouse: line.from_warehouse,
  from_channel: line.from_channel,
  to_warehouse: line.to_warehouse,
  to_channel: line.to_channel,
  qty: String(line.qty ?? ""),
  is_manual: line.is_manual,
  reason: line.reason ?? "",
});

const generateId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

const draftToPayload = (draft: LineDraft): TransferPlanLineWrite => ({
  line_id: draft.line_id,
  plan_id: draft.plan_id,
  sku_code: draft.sku_code.trim(),
  from_warehouse: draft.from_warehouse.trim(),
  from_channel: draft.from_channel.trim(),
  to_warehouse: draft.to_warehouse.trim(),
  to_channel: draft.to_channel.trim(),
  qty: Number.parseFloat(draft.qty),
  is_manual: draft.is_manual,
  reason: draft.reason.trim() ? draft.reason.trim() : null,
});

const formatDateRange = (start: string, end: string) =>
  start && end ? (start === end ? start : `${start} – ${end}`) : "";

const formatDateTime = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
};

const MATRIX_KEY_DELIMITER = "\u0000";

const makeMatrixKey = (sku: string, warehouse: string, channel: string) =>
  [sku, warehouse, channel].join(MATRIX_KEY_DELIMITER);

const buildMoveMap = (lines: LineDraft[]) => {
  const map = new Map<string, number>();
  for (const line of lines) {
    const sku = line.sku_code.trim();
    const fromWarehouse = line.from_warehouse.trim();
    const fromChannel = line.from_channel.trim();
    const toWarehouse = line.to_warehouse.trim();
    const toChannel = line.to_channel.trim();
    const qtyValue = Number.parseFloat(line.qty);
    if (
      !sku ||
      !fromWarehouse ||
      !fromChannel ||
      !toWarehouse ||
      !toChannel ||
      !Number.isFinite(qtyValue) ||
      qtyValue <= 0
    ) {
      continue;
    }
    const qty = qtyValue;
    const outgoingKey = makeMatrixKey(sku, fromWarehouse, fromChannel);
    const incomingKey = makeMatrixKey(sku, toWarehouse, toChannel);
    map.set(outgoingKey, (map.get(outgoingKey) ?? 0) - qty);
    map.set(incomingKey, (map.get(incomingKey) ?? 0) + qty);
  }
  return map;
};

const ensureOption = (options: string[], value: string) => {
  const trimmed = value.trim();
  if (!trimmed || options.includes(trimmed)) {
    return options;
  }
  return [...options, trimmed].sort((a, b) => a.localeCompare(b));
};

const formatCsvValue = (value: string | number | boolean | null | undefined) => {
  if (value === null || value === undefined) {
    return "";
  }
  const stringValue = String(value);
  const escaped = stringValue.replace(/"/g, '""');
  return /[",\r\n]/.test(stringValue) ? `"${escaped}"` : escaped;
};

const buildCsvContent = (rows: (string | number | boolean | null | undefined)[][]) =>
  rows.map((row) => row.map(formatCsvValue).join(",")).join("\r\n");

const PLAN_LINES_PAGE_SIZE = 5;

const compareLinesBySku = (a: LineDraft, b: LineDraft) => {
  const skuA = a.sku_code.trim();
  const skuB = b.sku_code.trim();
  const hasSkuA = skuA.length > 0;
  const hasSkuB = skuB.length > 0;
  if (hasSkuA && !hasSkuB) {
    return -1;
  }
  if (!hasSkuA && hasSkuB) {
    return 1;
  }
  if (!hasSkuA && !hasSkuB) {
    return a.line_id.localeCompare(b.line_id);
  }
  const skuCompare = skuA.localeCompare(skuB, undefined, { numeric: true, sensitivity: "base" });
  if (skuCompare !== 0) {
    return skuCompare;
  }
  const fromWarehouseCompare = a.from_warehouse.trim().localeCompare(b.from_warehouse.trim());
  if (fromWarehouseCompare !== 0) {
    return fromWarehouseCompare;
  }
  const fromChannelCompare = a.from_channel.trim().localeCompare(b.from_channel.trim());
  if (fromChannelCompare !== 0) {
    return fromChannelCompare;
  }
  const toWarehouseCompare = a.to_warehouse.trim().localeCompare(b.to_warehouse.trim());
  if (toWarehouseCompare !== 0) {
    return toWarehouseCompare;
  }
  const toChannelCompare = a.to_channel.trim().localeCompare(b.to_channel.trim());
  if (toChannelCompare !== 0) {
    return toChannelCompare;
  }
  return a.line_id.localeCompare(b.line_id);
};

const sortLinesBySku = (lineItems: LineDraft[]) => [...lineItems].sort(compareLinesBySku);

type LineFieldErrors = Partial<{
  sku_code: string;
  from_warehouse: string;
  from_channel: string;
  to_warehouse: string;
  to_channel: string;
  qty: string;
}>;

const getLineErrors = (line: LineDraft): LineFieldErrors => {
  const errors: LineFieldErrors = {};
  if (!line.sku_code.trim()) {
    errors.sku_code = "SKU code is required.";
  }
  if (!line.from_warehouse.trim()) {
    errors.from_warehouse = "From warehouse is required.";
  }
  if (!line.from_channel.trim()) {
    errors.from_channel = "From channel is required.";
  }
  if (!line.to_warehouse.trim()) {
    errors.to_warehouse = "To warehouse is required.";
  }
  if (!line.to_channel.trim()) {
    errors.to_channel = "To channel is required.";
  }
  const qtyValue = Number.parseFloat(line.qty);
  if (!Number.isFinite(qtyValue) || qtyValue <= 0 || !Number.isInteger(qtyValue)) {
    errors.qty = "Quantity must be a positive integer.";
  }
  return errors;
};

const BASE_REASON_OPTIONS = [
  "Manual adjustment",
  "Demand spike",
  "Inventory balancing",
  "Seasonal allocation",
  "fill main channel (intra)",
  "fill main channel (inter non-main)",
  "fill main channel (inter main)",
];

const formatRelativeTimeFromNow = (value: string) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const diffMs = Date.now() - date.getTime();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;
  if (diffMs < minute) {
    return "たった今";
  }
  if (diffMs < hour) {
    const minutes = Math.floor(diffMs / minute);
    return `${minutes}分前`;
  }
  if (diffMs < day) {
    const hours = Math.floor(diffMs / hour);
    return `${hours}時間前`;
  }
  const days = Math.floor(diffMs / day);
  return `${days}日前`;
};

export default function ReallocationPage() {
  const sessionsQuery = useSessionsQuery();
  const sessions = sessionsQuery.data ?? [];
  const leaderSession = useMemo(
    () => sessions.find((session) => session.is_leader) ?? null,
    [sessions],
  );

  const [selectedSessionId, setSelectedSessionId] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const [plan, setPlan] = useState<TransferPlan | null>(null);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [baselineLines, setBaselineLines] = useState<LineDraft[]>([]);
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [baseFilters, setBaseFilters] = useState<Omit<MatrixQueryArgs, "planId"> | null>(null);
  const [planDirty, setPlanDirty] = useState(false);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [hasAutoLoadedPlan, setHasAutoLoadedPlan] = useState(false);
  const [filtersExpanded, setFiltersExpanded] = useState(true);
  const [skuSearch, setSkuSearch] = useState("");
  const [planLinesPage, setPlanLinesPage] = useState(1);
  const [planSearchTerm, setPlanSearchTerm] = useState("");
  const [selectedLineIds, setSelectedLineIds] = useState<string[]>([]);
  const filterSectionId = useId();
  const skuDatalistId = useId();

  const summaryQuery = useSessionSummaryQuery(selectedSessionId);
  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );
  const sessionDataType = summaryQuery.data?.data_type ?? selectedSession?.data_mode ?? null;
  const isSummarySession = sessionDataType === "summary";
  const emptySummaryFilters = useMemo(
    () => ({}) as { sku_code?: string; warehouse_name?: string; channel?: string },
    [],
  );
  const summaryDailyQuery = useDailyPsiQuery(
    isSummarySession ? selectedSessionId : "",
    emptySummaryFilters,
  );
  const transferPlansQuery = useTransferPlansQuery(selectedSessionId || null, { limit: 50 });
  const loadPlanMutation = useTransferPlanDetailMutation();

  useEffect(() => {
    if (!selectedSessionId && sessions.length) {
      const fallback = leaderSession ?? sessions[0];
      setSelectedSessionId(fallback.id);
    }
  }, [leaderSession, selectedSessionId, sessions]);

  useEffect(() => {
    const summary = summaryQuery.data;
    if (!summary) {
      return;
    }
    if (!startDate && summary.start_date) {
      setStartDate(summary.start_date);
    }
    if (!endDate && summary.end_date) {
      setEndDate(summary.end_date);
    }
  }, [summaryQuery.data, startDate, endDate]);

  useEffect(() => {
    setPlan(null);
    setLines([]);
    setBaselineLines([]);
    setPlanDirty(false);
    setSelectedPlanId("");
    setHasAutoLoadedPlan(false);
  }, [selectedSessionId]);

  useEffect(() => {
    setPlanLinesPage(1);
  }, [plan?.plan_id]);

  useEffect(() => {
    setPlanLinesPage(1);
  }, [skuSearch]);

  useEffect(() => {
    setSelectedLineIds((prev) => prev.filter((id) => lines.some((line) => line.line_id === id)));
  }, [lines]);

  const matrixArgs = useMemo<MatrixQueryArgs | null>(() => {
    if (!baseFilters) {
      return null;
    }
    return {
      ...baseFilters,
      planId: plan?.plan_id ?? null,
    };
  }, [baseFilters, plan?.plan_id]);

  const matrixQuery = useMatrixQuery(matrixArgs);

  const recommendMutation = useRecommendPlanMutation();
  const saveLinesMutation = useSavePlanLinesMutation();

  const handleApplyFilters = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setStatus(null);
    if (!selectedSessionId) {
      setStatus({ type: "error", text: "Please select a session." });
      return;
    }
    if (isSummarySession) {
      setBaseFilters(null);
      return;
    }
    if (!startDate || !endDate) {
      setStatus({ type: "error", text: "Please select start and end dates." });
      return;
    }
    const nextFilters: Omit<MatrixQueryArgs, "planId"> = {
      sessionId: selectedSessionId,
      start: startDate,
      end: endDate,
    };
    setBaseFilters(nextFilters);
  };

  const handleRecommend = async () => {
    setStatus(null);
    if (!selectedSessionId) {
      setStatus({ type: "error", text: "Please select a session." });
      return;
    }
    if (!isSummarySession && (!startDate || !endDate)) {
      setStatus({ type: "error", text: "Please select start and end dates." });
      return;
    }
    try {
      const response = await recommendMutation.mutateAsync({
        sessionId: selectedSessionId,
        start: startDate || undefined,
        end: endDate || undefined,
      });
      setPlan(response.plan);
      const nextLines = response.lines.map(toDraftLine);
      setLines(nextLines);
      setBaselineLines(nextLines);
      setPlanDirty(false);
      setStatus({ type: "success", text: "Recommendation created." });
      setSelectedPlanId(response.plan.plan_id);
      if (!isSummarySession && startDate && endDate) {
        setBaseFilters({
          sessionId: selectedSessionId,
          start: startDate,
          end: endDate,
        });
      } else {
        setBaseFilters(null);
      }
      await transferPlansQuery.refetch();
    } catch (error) {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Failed to create recommendation."),
      });
    }
  };

  const handleLineChange = (lineId: string, patch: Partial<LineDraft>) => {
    setLines((prev) =>
      prev.map((line) => (line.line_id === lineId ? { ...line, ...patch } : line)),
    );
    setPlanDirty(true);
  };

  const handleRemoveLine = (lineId: string) => {
    setLines((prev) => prev.filter((line) => line.line_id !== lineId));
    setPlanDirty(true);
  };

  const handleAddLine = () => {
    if (!plan) {
      return;
    }
    const newLine: LineDraft = {
      line_id: generateId(),
      plan_id: plan.plan_id,
      sku_code: "",
      from_warehouse: "",
      from_channel: "",
      to_warehouse: "",
      to_channel: "",
      qty: "0",
      is_manual: true,
      reason: "",
    };
    setLines((prev) => [...prev, newLine]);
    setPlanLinesPage(Math.max(1, Math.ceil((lines.length + 1) / PLAN_LINES_PAGE_SIZE)));
    setPlanDirty(true);
  };

  const handleSelectLine = (lineId: string, selected: boolean) => {
    setSelectedLineIds((prev) => {
      if (selected) {
        if (prev.includes(lineId)) {
          return prev;
        }
        return [...prev, lineId];
      }
      return prev.filter((id) => id !== lineId);
    });
  };

  const handleSelectAllVisible = useCallback((selected: boolean, visibleLines: LineDraft[]) => {
    setSelectedLineIds((prev) => {
      if (selected) {
        const set = new Set(prev);
        visibleLines.forEach((line) => set.add(line.line_id));
        return Array.from(set);
      }
      const visibleIds = new Set(visibleLines.map((line) => line.line_id));
      return prev.filter((id) => !visibleIds.has(id));
    });
  }, []);

  const handleBulkManualChange = useCallback(
    (isManual: boolean) => {
      if (!selectedLineIds.length) {
        return;
      }
      setLines((prev) =>
        prev.map((line) =>
          selectedLineIds.includes(line.line_id) ? { ...line, is_manual: isManual } : line,
        ),
      );
      setPlanDirty(true);
    },
    [selectedLineIds],
  );

  const handleSave = useCallback(async () => {
    if (!plan) {
      return;
    }
    setStatus(null);

    const payload: TransferPlanLineWrite[] = [];
    for (const line of lines) {
      const errors = getLineErrors(line);
      if (Object.keys(errors).length > 0) {
        const message = Object.values(errors)[0] ?? "Line validation failed.";
        setStatus({ type: "error", text: message });
        return;
      }
      payload.push(draftToPayload(line));
    }

    try {
      await saveLinesMutation.mutateAsync({ planId: plan.plan_id, lines: payload });
      setStatus({ type: "success", text: "Transfer plan saved." });
      setPlanDirty(false);
      const normalizedLines = payload.map((line) => ({
        line_id: line.line_id ?? generateId(),
        plan_id: plan.plan_id,
        sku_code: line.sku_code,
        from_warehouse: line.from_warehouse,
        from_channel: line.from_channel,
        to_warehouse: line.to_warehouse,
        to_channel: line.to_channel,
        qty: String(line.qty),
        is_manual: line.is_manual,
        reason: line.reason ?? "",
      }));
      setLines(normalizedLines);
      setBaselineLines(normalizedLines);
      setSelectedLineIds([]);
      await Promise.all([
        matrixArgs ? matrixQuery.refetch() : Promise.resolve(),
        transferPlansQuery.refetch(),
      ]);
    } catch (error) {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Failed to save plan lines."),
      });
    }
  }, [
    lines,
    matrixArgs,
    matrixQuery,
    plan,
    saveLinesMutation,
    transferPlansQuery,
  ]);

  const loadPlanById = useCallback(
    async (planId: string, options?: { silent?: boolean }) => {
      if (!planId) {
        return;
      }
      const silent = options?.silent ?? false;
      if (!silent) {
        setStatus(null);
      }
      try {
        const response = await loadPlanMutation.mutateAsync(planId);
        const loadedPlan = response.plan;
        if (loadedPlan.session_id !== selectedSessionId) {
          setSelectedSessionId(loadedPlan.session_id);
        }
        setSelectedPlanId(loadedPlan.plan_id);
        setStartDate(loadedPlan.start_date);
        setEndDate(loadedPlan.end_date);
        setPlan(loadedPlan);
        const nextLines = response.lines.map(toDraftLine);
        setLines(nextLines);
        setBaselineLines(nextLines);
        setPlanDirty(false);
        const planSession = sessions.find((session) => session.id === loadedPlan.session_id);
        const planIsSummary = planSession?.data_mode === "summary";
        if (planIsSummary) {
          setBaseFilters(null);
        } else {
          setBaseFilters({
            sessionId: loadedPlan.session_id,
            start: loadedPlan.start_date,
            end: loadedPlan.end_date,
          });
        }
        if (!silent) {
          setStatus({ type: "success", text: "Plan loaded." });
        }
      } catch (error) {
        setStatus({
          type: "error",
          text: getErrorMessage(error, "Failed to load plan."),
        });
        throw error;
      }
    },
    [loadPlanMutation, selectedSessionId, sessions],
  );

  const handleLoadPlan = async () => {
    if (!selectedPlanId) {
      return;
    }
    try {
      await loadPlanById(selectedPlanId);
    } catch {
      // Errors are surfaced via setStatus inside loadPlanById.
    }
  };

  useEffect(() => {
    const handleKeydown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) {
        return;
      }
      if (event.key.toLowerCase() !== "s") {
        return;
      }
      event.preventDefault();
      if (!planDirty || saveLinesMutation.isPending) {
        return;
      }
      void handleSave();
    };
    window.addEventListener("keydown", handleKeydown);
    return () => window.removeEventListener("keydown", handleKeydown);
  }, [handleSave, planDirty, saveLinesMutation.isPending]);

  const planOptions = useMemo(() => {
    const data = transferPlansQuery.data ?? [];
    const filtered = data.filter((item) => {
      if (startDate && item.start_date !== startDate) {
        return false;
      }
      if (endDate && item.end_date !== endDate) {
        return false;
      }
      return true;
    });
    return filtered
      .slice()
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  }, [endDate, startDate, transferPlansQuery.data]);

  useEffect(() => {
    if (hasAutoLoadedPlan || plan || loadPlanMutation.isPending) {
      return;
    }
    if (planOptions.length === 0) {
      return;
    }
    const latestPlan = planOptions[0];
    if (!latestPlan) {
      return;
    }
    setHasAutoLoadedPlan(true);
    setSelectedPlanId(latestPlan.plan_id);
    void loadPlanById(latestPlan.plan_id, { silent: true });
  }, [
    hasAutoLoadedPlan,
    loadPlanById,
    loadPlanMutation.isPending,
    plan,
    planOptions,
  ]);

  const latestPlan = planOptions[0] ?? null;
  const latestPlanRelative = latestPlan
    ? formatRelativeTimeFromNow(latestPlan.updated_at || latestPlan.created_at)
    : null;

  const filteredPlanOptions = useMemo(() => {
    const normalized = planSearchTerm.trim().toLowerCase();
    let filtered = !normalized
      ? planOptions
      : planOptions.filter((item) => {
          const text = [
            item.plan_id,
            item.start_date,
            item.end_date,
            item.created_by ?? "",
            item.updated_by ?? "",
          ]
            .join(" ")
            .toLowerCase();
          return text.includes(normalized);
        });
    if (selectedPlanId) {
      const selectedPlan = planOptions.find((planItem) => planItem.plan_id === selectedPlanId);
      if (selectedPlan && !filtered.some((planItem) => planItem.plan_id === selectedPlan.plan_id)) {
        filtered = [selectedPlan, ...filtered];
      }
    }
    return filtered;
  }, [planOptions, planSearchTerm, selectedPlanId]);

  const planSelectOptions = useMemo(
    () =>
      filteredPlanOptions.map((item) => {
        const rangeLabel = formatDateRange(item.start_date, item.end_date);
        const updatedLabel = formatDateTime(item.updated_at || item.created_at);
        const prefix = rangeLabel ? `${rangeLabel} • ` : "";
        return {
          value: item.plan_id,
          label: `${prefix}更新 ${updatedLabel}`,
        };
      }),
    [filteredPlanOptions],
  );

  const isPlanListLoading = transferPlansQuery.isLoading || transferPlansQuery.isFetching;
  const hasPlanOptions = planOptions.length > 0;
  const hasFilteredPlanOptions = planSelectOptions.length > 0;
  const isLoadPlanDisabled = !selectedPlanId || loadPlanMutation.isPending;

  useEffect(() => {
    if (!selectedPlanId) {
      return;
    }
    if (!planOptions.some((plan) => plan.plan_id === selectedPlanId)) {
      setSelectedPlanId("");
    }
  }, [planOptions, selectedPlanId]);

  const summaryMatrixRows = useMemo<MatrixRow[]>(() => {
    if (!isSummarySession) {
      return [];
    }
    const channels = summaryDailyQuery.data ?? [];
    const rows: MatrixRow[] = [];
    channels.forEach((channel) => {
      const latestEntry = channel.daily[channel.daily.length - 1];
      if (!latestEntry) {
        return;
      }
      const stockClosing = Number(latestEntry.stock_closing ?? 0);
      const stdStock = Number(latestEntry.stdstock ?? 0);
      const stockAtAnchor = Number(latestEntry.stock_at_anchor ?? stockClosing);
      const inboundQty = Number(latestEntry.inbound_qty ?? 0);
      const outboundQty = Number(latestEntry.outbound_qty ?? 0);
      const gapValue =
        typeof latestEntry.gap === "number" ? Number(latestEntry.gap) : stdStock - stockClosing;
      rows.push({
        sku_code: channel.sku_code,
        sku_name: channel.sku_name ?? null,
        warehouse_name: channel.warehouse_name,
        channel: channel.channel,
        category_1: channel.category_1 ?? null,
        category_2: channel.category_2 ?? null,
        category_3: channel.category_3 ?? null,
        stock_at_anchor: stockAtAnchor,
        inbound_qty: inboundQty,
        outbound_qty: outboundQty,
        stock_closing: stockClosing,
        stdstock: stdStock,
        gap: gapValue,
        move: 0,
        stock_fin: stockClosing,
      });
    });
    return rows;
  }, [isSummarySession, summaryDailyQuery.data]);

  const usingSummaryMatrix = isSummarySession && !baseFilters;

  const baseMatrixRows: MatrixRow[] = usingSummaryMatrix
    ? summaryMatrixRows
    : matrixQuery.data ?? [];

  const baselineMoveMap = useMemo(() => buildMoveMap(baselineLines), [baselineLines]);
  const draftMoveMap = useMemo(() => buildMoveMap(lines), [lines]);

  const skuNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of baseMatrixRows) {
      if (row.sku_name) {
        map.set(row.sku_code, row.sku_name);
      }
    }
    return map;
  }, [baseMatrixRows]);

  const simulatedMatrixRows = useMemo(() => {
    const baseMap = new Map<string, MatrixRow>();
    for (const row of baseMatrixRows) {
      baseMap.set(makeMatrixKey(row.sku_code, row.warehouse_name, row.channel), row);
    }
    const keys = new Set<string>([
      ...baseMap.keys(),
      ...baselineMoveMap.keys(),
      ...draftMoveMap.keys(),
    ]);
    const result: MatrixRow[] = [];
    keys.forEach((key) => {
      const baseRow = baseMap.get(key);
      const [sku_code, warehouse_name, channel] = key.split(MATRIX_KEY_DELIMITER);
      const baseMove = baseRow?.move ?? 0;
      const savedMove = baselineMoveMap.get(key) ?? 0;
      const draftMove = draftMoveMap.get(key) ?? 0;
      const move = usingSummaryMatrix ? baseMove + draftMove : baseMove - savedMove + draftMove;
      const stock_closing = baseRow?.stock_closing ?? 0;
      const stock_fin = stock_closing + move;
      const stock_at_anchor = baseRow?.stock_at_anchor ?? 0;
      const inbound_qty = baseRow?.inbound_qty ?? 0;
      const outbound_qty = baseRow?.outbound_qty ?? 0;
      const stdstock = baseRow?.stdstock ?? 0;
      const gap = stdstock - stock_closing;
      const sku_name = baseRow?.sku_name ?? skuNameMap.get(sku_code) ?? null;
      const category_1 = baseRow?.category_1 ?? null;
      const category_2 = baseRow?.category_2 ?? null;
      const category_3 = baseRow?.category_3 ?? null;
      result.push({
        sku_code,
        sku_name,
        warehouse_name,
        channel,
        category_1,
        category_2,
        category_3,
        stock_at_anchor,
        inbound_qty,
        outbound_qty,
        stock_closing,
        stdstock,
        gap,
        move,
        stock_fin,
      });
    });
    return result.sort((a, b) => {
      if (a.sku_code !== b.sku_code) {
        return a.sku_code.localeCompare(b.sku_code);
      }
      if (a.warehouse_name !== b.warehouse_name) {
        return a.warehouse_name.localeCompare(b.warehouse_name);
      }
      return a.channel.localeCompare(b.channel);
    });
  }, [baseMatrixRows, baselineMoveMap, draftMoveMap, skuNameMap, usingSummaryMatrix]);

  const skuOptions = useMemo(() => {
    const optionMap = new Map<string, string | null>();
    for (const row of baseMatrixRows) {
      if (!optionMap.has(row.sku_code)) {
        optionMap.set(row.sku_code, row.sku_name ?? null);
      }
    }
    for (const line of [...baselineLines, ...lines]) {
      const code = line.sku_code.trim();
      if (!code || optionMap.has(code)) {
        continue;
      }
      optionMap.set(code, skuNameMap.get(code) ?? null);
    }
    return Array.from(optionMap.entries())
      .map(([code, name]) => ({ code, name }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [baseMatrixRows, baselineLines, lines, skuNameMap]);

  const skuOptionNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const option of skuOptions) {
      if (option.name) {
        map.set(option.code, option.name);
      }
    }
    return map;
  }, [skuOptions]);

  const filteredPlanLines = useMemo(() => {
    const normalizedSearch = skuSearch.trim().toLowerCase();
    if (!normalizedSearch) {
      return lines;
    }
    return lines.filter((line) => {
      const code = line.sku_code.trim();
      const name = skuNameMap.get(code) ?? skuOptionNameMap.get(code) ?? "";
      return (
        code.toLowerCase().includes(normalizedSearch) || name.toLowerCase().includes(normalizedSearch)
      );
    });
  }, [lines, skuNameMap, skuOptionNameMap, skuSearch]);

  const sortedPlanLines = useMemo(() => sortLinesBySku(filteredPlanLines), [filteredPlanLines]);

  const totalPlanLinePages = Math.max(1, Math.ceil(sortedPlanLines.length / PLAN_LINES_PAGE_SIZE));

  useEffect(() => {
    setPlanLinesPage((prev) => {
      if (prev <= totalPlanLinePages) {
        return prev;
      }
      return totalPlanLinePages;
    });
  }, [totalPlanLinePages]);

  const paginatedPlanLines = useMemo(() => {
    const startIndex = (planLinesPage - 1) * PLAN_LINES_PAGE_SIZE;
    return sortedPlanLines.slice(startIndex, startIndex + PLAN_LINES_PAGE_SIZE);
  }, [planLinesPage, sortedPlanLines]);

  const planLinesTotal = sortedPlanLines.length;
  const planLinesDisplayStart = planLinesTotal === 0 ? 0 : (planLinesPage - 1) * PLAN_LINES_PAGE_SIZE + 1;
  const planLinesDisplayEnd = Math.min(planLinesTotal, planLinesPage * PLAN_LINES_PAGE_SIZE);
  const allVisibleSelected =
    paginatedPlanLines.length > 0 &&
    paginatedPlanLines.every((line) => selectedLineIds.includes(line.line_id));

  const lineErrorMap = useMemo(() => {
    const map = new Map<string, LineFieldErrors>();
    for (const line of lines) {
      const errors = getLineErrors(line);
      if (Object.keys(errors).length > 0) {
        map.set(line.line_id, errors);
      }
    }
    return map;
  }, [lines]);

  const handleExportLinesCsv = useCallback(() => {
    if (!lines.length || typeof window === "undefined") {
      return;
    }

    const planId = plan?.plan_id ?? "";
    const header: string[] = [
      "Plan ID",
      "SKU",
      "SKU name",
      "From warehouse",
      "From channel",
      "To warehouse",
      "To channel",
      "Qty",
      "Manual?",
      "Reason",
    ];

    const rows = sortLinesBySku(lines).map((line) => {
      const trimmedSku = line.sku_code.trim();
      const skuName = skuNameMap.get(trimmedSku) ?? skuOptionNameMap.get(trimmedSku) ?? "";
      return [
        planId,
        trimmedSku,
        skuName,
        line.from_warehouse.trim(),
        line.from_channel.trim(),
        line.to_warehouse.trim(),
        line.to_channel.trim(),
        line.qty.trim(),
        line.is_manual ? "はい" : "いいえ",
        line.reason,
      ];
    });

    const csvContent = buildCsvContent([header, ...rows]);
    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const planLabel = planId ? `plan-${planId}` : "draft";
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    anchor.href = url;
    anchor.download = `transfer-plan-lines_${planLabel}_${timestamp}.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, [lines, plan?.plan_id, skuNameMap, skuOptionNameMap]);

  const warehouseOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of baseMatrixRows) {
      set.add(row.warehouse_name);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [baseMatrixRows]);

  const channelsByWarehouse = useMemo(() => {
    const map = new Map<string, string[]>();
    const accumulator = new Map<string, Set<string>>();
    for (const row of baseMatrixRows) {
      const warehouse = row.warehouse_name;
      let set = accumulator.get(warehouse);
      if (!set) {
        set = new Set<string>();
        accumulator.set(warehouse, set);
      }
      set.add(row.channel);
    }
    accumulator.forEach((set, warehouse) => {
      map.set(warehouse, Array.from(set).sort((a, b) => a.localeCompare(b)));
    });
    return map;
  }, [baseMatrixRows]);

  const channelOptions = useMemo(() => {
    const set = new Set<string>();
    for (const row of baseMatrixRows) {
      set.add(row.channel);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [baseMatrixRows]);

  const reasonOptions = useMemo(() => {
    const extras = new Set<string>();
    for (const line of [...baselineLines, ...lines]) {
      const trimmed = line.reason.trim();
      if (!trimmed) {
        continue;
      }
      if (!BASE_REASON_OPTIONS.includes(trimmed)) {
        extras.add(trimmed);
      }
    }
    return [...BASE_REASON_OPTIONS, ...Array.from(extras).sort((a, b) => a.localeCompare(b))];
  }, [baselineLines, lines]);

  const skuList = useMemo(
    () => Array.from(new Set(simulatedMatrixRows.map((row) => row.sku_code))),
    [simulatedMatrixRows],
  );

  const psiRows = useMemo(
    () =>
      simulatedMatrixRows.map((row) => {
        const stockStart = row.stock_at_anchor ?? 0;
        const stdStock = row.stdstock ?? 0;
        const stockClosing = row.stock_closing ?? 0;
        const move = row.move ?? 0;
        const gap = stdStock - stockClosing;
        const gapAfter = gap + move;
        return {
          sku: row.sku_code,
          skuName: row.sku_name ?? undefined,
          warehouse: row.warehouse_name,
          channel: row.channel,
          category_1: row.category_1 ?? null,
          category_2: row.category_2 ?? null,
          category_3: row.category_3 ?? null,
          stockStart: row.stock_at_anchor,
          inbound: row.inbound_qty,
          outbound: row.outbound_qty,
          stockClosing: row.stock_closing,
          stdStock: row.stdstock,
          gap,
          move: row.move,
          stockFinal: row.stock_fin,
          gapAfter,
        };
      }),
    [simulatedMatrixRows],
  );

  const isMatrixLoading = usingSummaryMatrix
    ? summaryDailyQuery.isLoading
    : matrixQuery.isLoading;
  const isMatrixFetching = usingSummaryMatrix
    ? summaryDailyQuery.isFetching
    : matrixQuery.isFetching;
  const isMatrixError = usingSummaryMatrix
    ? summaryDailyQuery.isError
    : matrixQuery.isError;
  const matrixErrorText = usingSummaryMatrix
    ? "Failed to load summary data."
    : "Failed to load matrix data.";

  return (
    <div className="page reallocation-page">
      <h1>在庫再配置</h1>

      <section
        className={`reallocation-filter-section ${filtersExpanded ? "expanded" : "collapsed"}`}
      >
        <div className="reallocation-filter-header">
          <h2>Session / Plan Controls</h2>
          <button
            type="button"
            className="reallocation-filter-toggle"
            onClick={() => setFiltersExpanded((prev) => !prev)}
            aria-expanded={filtersExpanded}
            aria-controls={filterSectionId}
          >
            {filtersExpanded ? "折りたたむ" : "展開する"}
          </button>
        </div>
        <form
          id={filterSectionId}
          className="reallocation-filter-form"
          onSubmit={handleApplyFilters}
        >
          <div className="reallocation-filter-grid">
            <div className="reallocation-filter-panel">
              <label>
                Session
                <select
                  value={selectedSessionId}
                  onChange={(event) => setSelectedSessionId(event.target.value)}
                >
                  <option value="">Select session</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title}
                    </option>
                  ))}
                </select>
              </label>
              {isSummarySession && (
                <p className="reallocation-filter-status">
                  Summary sessions display aggregated totals from the latest upload. Use the
                  filters below to generate or edit transfer plans against the summary snapshot.
                </p>
              )}
              <div className="reallocation-filter-dates">
                <label>
                  Start date
                  <input
                    type="date"
                    value={startDate}
                    onChange={(event) => setStartDate(event.target.value)}
                  />
                </label>
                <label>
                  End date
                  <input
                    type="date"
                    value={endDate}
                    onChange={(event) => setEndDate(event.target.value)}
                  />
                </label>
              </div>
            </div>
            <div className="reallocation-filter-panel">
              <div className="plan-select-header">
                <label htmlFor="plan-search-input">作成済みプラン</label>
                {latestPlan && latestPlanRelative && (
                  <div className="plan-latest-indicator" aria-live="polite">
                    <span className="badge-new">NEW</span>
                    <span className="plan-latest-text">
                      {latestPlan.plan_id} • 最終更新 {latestPlanRelative}
                    </span>
                  </div>
                )}
              </div>
              <div className="plan-select-controls">
                <input
                  id="plan-search-input"
                  type="search"
                  placeholder="プランID・日付・作成者で検索"
                  value={planSearchTerm}
                  onChange={(event) => setPlanSearchTerm(event.target.value)}
                  aria-label="保存済みプランを検索"
                />
                <select
                  value={selectedPlanId}
                  onChange={(event) => setSelectedPlanId(event.target.value)}
                  disabled={!hasPlanOptions || isPlanListLoading}
                  aria-label="保存済みプランを選択"
                >
                  <option value="">Select plan</option>
                  {planSelectOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              {isPlanListLoading && (
                <p className="reallocation-filter-status">Loading saved plans…</p>
              )}
              {transferPlansQuery.isError && (
                <p className="reallocation-filter-status error">Failed to load saved plans.</p>
              )}
              {!isPlanListLoading && !hasPlanOptions && (
                <p className="reallocation-filter-status">
                  No saved plans match the selected filters.
                </p>
              )}
              {!isPlanListLoading && hasPlanOptions && !hasFilteredPlanOptions && (
                <p className="reallocation-filter-status">検索条件に一致するプランがありません。</p>
              )}
            </div>
          </div>
          <div className="reallocation-filter-actions">
            <button type="submit" disabled={isMatrixFetching}>
              Apply filters
            </button>
            <button
              type="button"
              onClick={handleRecommend}
              disabled={recommendMutation.isPending}
            >
              {recommendMutation.isPending ? "Creating…" : "Create recommendation"}
            </button>
            <button type="button" onClick={handleLoadPlan} disabled={isLoadPlanDisabled}>
              {loadPlanMutation.isPending ? "Loading…" : "Load plan"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => {
                void transferPlansQuery.refetch();
              }}
              disabled={transferPlansQuery.isFetching}
            >
              {transferPlansQuery.isFetching ? "Refreshing…" : "Refresh list"}
            </button>
          </div>
        </form>
      </section>

      {status && <div className={`status-message ${status.type}`}>{status.text}</div>}

      <section className="matrix-section">
        <h2>PSI Matrix</h2>
        {isMatrixLoading && <p>Loading matrix…</p>}
        {isMatrixError && !isMatrixLoading && (
          <p className="error-text">{matrixErrorText}</p>
        )}
        {!isMatrixLoading && !isMatrixError && simulatedMatrixRows.length === 0 && (
          <p>No data for the selected filters.</p>
        )}
        {usingSummaryMatrix && !isMatrixLoading && !isMatrixError && simulatedMatrixRows.length > 0 && (
          <p className="reallocation-filter-status">
            Showing aggregated SKU × warehouse × channel totals from the latest summary upload.
          </p>
        )}
        {simulatedMatrixRows.length > 0 && (
          <PSIMatrixTabs
            data={psiRows}
            skuList={skuList}
            skuSearch={skuSearch}
            onSkuSearchChange={setSkuSearch}
          />
        )}
      </section>

      <section className="plan-lines-section">
        <div className="plan-header">
          <div className="plan-header-left">
            <h2>Transfer Plan Lines</h2>
            <span
              className={`save-indicator ${planDirty ? "unsaved" : "saved"}`}
              role="status"
              aria-live="polite"
            >
              {planDirty ? "Unsaved changes" : "Saved"}
            </span>
          </div>
          <div className="plan-actions">
            <button
              type="button"
              onClick={handleAddLine}
              disabled={!plan}
              aria-label="手動ラインを追加"
            >
              Add manual line
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!plan || !planDirty || saveLinesMutation.isPending}
              aria-label="プランラインを保存"
            >
              {saveLinesMutation.isPending ? "Saving…" : "Save lines"}
            </button>
            <button
              type="button"
              className="secondary"
              onClick={handleExportLinesCsv}
              disabled={lines.length === 0}
              aria-label="CSVをダウンロード"
            >
              CSVダウンロード
            </button>
          </div>
        </div>
        {!plan && <p>No plan loaded. Create a recommendation to begin.</p>}
        {plan && (
          <>
            <div className="plan-lines-toolbar">
              <p className="plan-lines-count">
                {planLinesTotal === 0
                  ? skuSearch.trim()
                    ? "SKU検索に一致するラインがありません。"
                    : "登録済みのラインがありません。"
                  : `表示中 ${planLinesDisplayStart}–${planLinesDisplayEnd} 件 / 全 ${planLinesTotal} 件`}
              </p>
              {planLinesTotal > 0 && (
                <div className="plan-toolbar-actions">
                  <div className="plan-bulk-actions">
                    <button
                      type="button"
                      onClick={() => handleBulkManualChange(true)}
                      disabled={selectedLineIds.length === 0}
                      aria-label="選択行をManualに設定"
                    >
                      ManualをON
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBulkManualChange(false)}
                      disabled={selectedLineIds.length === 0}
                      aria-label="選択行のManualを解除"
                    >
                      ManualをOFF
                    </button>
                  </div>
                  <div className="plan-lines-pagination">
                    <button
                      type="button"
                      onClick={() => setPlanLinesPage((prev) => Math.max(1, prev - 1))}
                      disabled={planLinesPage <= 1}
                    >
                      ‹ 前へ
                    </button>
                    <span>
                      ページ {planLinesPage} / {Math.max(1, totalPlanLinePages)}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setPlanLinesPage((prev) =>
                          prev >= totalPlanLinePages ? totalPlanLinePages : prev + 1,
                        )
                      }
                      disabled={planLinesPage >= totalPlanLinePages}
                    >
                      次へ ›
                    </button>
                  </div>
                </div>
              )}
            </div>
            {paginatedPlanLines.length > 0 ? (
              <div className="table-wrapper">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th className="select-column">
                        <input
                          type="checkbox"
                          checked={allVisibleSelected}
                          onChange={(event) =>
                            handleSelectAllVisible(event.target.checked, paginatedPlanLines)
                          }
                          aria-label="表示中のラインをすべて選択"
                          disabled={paginatedPlanLines.length === 0}
                        />
                      </th>
                      <th>SKU</th>
                      <th>SKU name</th>
                      <th>From warehouse</th>
                      <th>From channel</th>
                      <th>To warehouse</th>
                      <th>To channel</th>
                      <th>Qty</th>
                      <th>Manual?</th>
                      <th>Reason</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {paginatedPlanLines.map((line) => {
                      const trimmedSku = line.sku_code.trim();
                      const skuName =
                        skuNameMap.get(trimmedSku) ?? skuOptionNameMap.get(trimmedSku) ?? "";
                      const fromWarehouseOptions = ensureOption(
                        warehouseOptions,
                        line.from_warehouse,
                      );
                      const fromWarehouseKey = line.from_warehouse.trim();
                      const toWarehouseOptions = ensureOption(warehouseOptions, line.to_warehouse);
                      const toWarehouseKey = line.to_warehouse.trim();
                      const fromChannelBase =
                        channelsByWarehouse.get(fromWarehouseKey) ?? channelOptions;
                      const toChannelBase =
                        channelsByWarehouse.get(toWarehouseKey) ?? channelOptions;
                      const fromChannelOptions = ensureOption(fromChannelBase, line.from_channel);
                      const toChannelOptions = ensureOption(toChannelBase, line.to_channel);
                      const errors = lineErrorMap.get(line.line_id) ?? {};
                      const isSelected = selectedLineIds.includes(line.line_id);

                      return (
                        <tr key={line.line_id} className={isSelected ? "line-selected" : undefined}>
                          <td className="select-column">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(event) =>
                                handleSelectLine(line.line_id, event.target.checked)
                              }
                              aria-label={`ライン ${trimmedSku || line.line_id} を選択`}
                            />
                          </td>
                          <td>
                            <input
                              list={skuDatalistId}
                              value={line.sku_code}
                              onChange={(event) =>
                                handleLineChange(line.line_id, { sku_code: event.target.value })
                              }
                              className={errors.sku_code ? "input-invalid" : undefined}
                              aria-invalid={Boolean(errors.sku_code)}
                              title={errors.sku_code}
                            />
                          </td>
                          <td>{skuName}</td>
                          <td>
                            <select
                              value={line.from_warehouse}
                              onChange={(event) =>
                                handleLineChange(line.line_id, {
                                  from_warehouse: event.target.value,
                                })
                              }
                              className={errors.from_warehouse ? "input-invalid" : undefined}
                              aria-invalid={Boolean(errors.from_warehouse)}
                              title={errors.from_warehouse}
                            >
                              <option value="">Select warehouse</option>
                              {fromWarehouseOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              value={line.from_channel}
                              onChange={(event) =>
                                handleLineChange(line.line_id, {
                                  from_channel: event.target.value,
                                })
                              }
                              className={errors.from_channel ? "input-invalid" : undefined}
                              aria-invalid={Boolean(errors.from_channel)}
                              title={errors.from_channel}
                            >
                              <option value="">Select channel</option>
                              {fromChannelOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              value={line.to_warehouse}
                              onChange={(event) =>
                                handleLineChange(line.line_id, {
                                  to_warehouse: event.target.value,
                                })
                              }
                              className={errors.to_warehouse ? "input-invalid" : undefined}
                              aria-invalid={Boolean(errors.to_warehouse)}
                              title={errors.to_warehouse}
                            >
                              <option value="">Select warehouse</option>
                              {toWarehouseOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <select
                              value={line.to_channel}
                              onChange={(event) =>
                                handleLineChange(line.line_id, {
                                  to_channel: event.target.value,
                                })
                              }
                              className={errors.to_channel ? "input-invalid" : undefined}
                              aria-invalid={Boolean(errors.to_channel)}
                              title={errors.to_channel}
                            >
                              <option value="">Select channel</option>
                              {toChannelOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <input
                              type="number"
                              step={1}
                              min="0"
                              value={line.qty}
                              onChange={(event) =>
                                handleLineChange(line.line_id, { qty: event.target.value })
                              }
                              className={errors.qty ? "input-invalid" : undefined}
                              aria-invalid={Boolean(errors.qty)}
                              title={errors.qty}
                            />
                          </td>
                          <td className="checkbox-cell">
                            <input
                              type="checkbox"
                              checked={line.is_manual}
                              onChange={(event) =>
                                handleLineChange(line.line_id, { is_manual: event.target.checked })
                              }
                              aria-label={`ライン ${trimmedSku || line.line_id} のmanual設定`}
                            />
                          </td>
                          <td>
                            <select
                              value={line.reason}
                              onChange={(event) =>
                                handleLineChange(line.line_id, { reason: event.target.value })
                              }
                            >
                              <option value="">理由を選択</option>
                              {reasonOptions.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td>
                            <button
                              type="button"
                              onClick={() => handleRemoveLine(line.line_id)}
                              aria-label="ラインを削除"
                            >
                              Remove
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        )}
        <datalist id={skuDatalistId}>
          {skuOptions.map((option) => (
            <option key={option.code} value={option.code}>
              {option.name ? `${option.code} — ${option.name}` : option.code}
            </option>
          ))}
        </datalist>
        </section>
    </div>
  );
}
