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
import { useSessionsQuery, useSessionSummaryQuery } from "../hooks/usePsiQueries";
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
    const outgoingKey = makeMatrixKey(sku, fromWarehouse, fromChannel);
    const incomingKey = makeMatrixKey(sku, toWarehouse, toChannel);
    map.set(outgoingKey, (map.get(outgoingKey) ?? 0) - qtyValue);
    map.set(incomingKey, (map.get(incomingKey) ?? 0) + qtyValue);
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
  const skuDatalistId = useId();

  const summaryQuery = useSessionSummaryQuery(selectedSessionId);
  const transferPlansQuery = useTransferPlansQuery(selectedSessionId, {
    limit: 50,
  });
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
    if (!selectedSessionId || !startDate || !endDate) {
      setStatus({ type: "error", text: "Please select session, start, and end dates." });
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
    if (!selectedSessionId || !startDate || !endDate) {
      setStatus({ type: "error", text: "Please select session, start, and end dates." });
      return;
    }
    try {
      const response = await recommendMutation.mutateAsync({
        sessionId: selectedSessionId,
        start: startDate,
        end: endDate,
      });
      setPlan(response.plan);
      const nextLines = response.lines.map(toDraftLine);
      setLines(nextLines);
      setBaselineLines(nextLines);
      setPlanDirty(false);
      setStatus({ type: "success", text: "Recommendation created." });
      setSelectedPlanId(response.plan.plan_id);
      setBaseFilters({
        sessionId: selectedSessionId,
        start: startDate,
        end: endDate,
      });
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
    setPlanDirty(true);
  };

  const handleSave = async () => {
    if (!plan) {
      return;
    }
    setStatus(null);

    const payload: TransferPlanLineWrite[] = [];
    for (const line of lines) {
      if (!line.sku_code.trim()) {
        setStatus({ type: "error", text: "SKU code is required for all lines." });
        return;
      }
      if (!line.from_warehouse.trim() || !line.from_channel.trim()) {
        setStatus({
          type: "error",
          text: "From warehouse and channel are required for all lines.",
        });
        return;
      }
      if (!line.to_warehouse.trim() || !line.to_channel.trim()) {
        setStatus({
          type: "error",
          text: "To warehouse and channel are required for all lines.",
        });
        return;
      }
      const qtyValue = Number.parseFloat(line.qty);
      if (!Number.isFinite(qtyValue) || qtyValue <= 0) {
        setStatus({ type: "error", text: "Quantity must be a positive number." });
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
      if (matrixArgs) {
        await matrixQuery.refetch();
      }
      await transferPlansQuery.refetch();
    } catch (error) {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Failed to save plan lines."),
      });
    }
  };

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
        setBaseFilters({
          sessionId: loadedPlan.session_id,
          start: loadedPlan.start_date,
          end: loadedPlan.end_date,
        });
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
    [loadPlanMutation, selectedSessionId],
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
  }, [transferPlansQuery.data, startDate, endDate]);

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
  }, [hasAutoLoadedPlan, plan, planOptions, loadPlanById, loadPlanMutation.isPending]);

  const planSelectOptions = useMemo(
    () =>
      planOptions.map((item) => {
        const rangeLabel = formatDateRange(item.start_date, item.end_date);
        const createdLabel = formatDateTime(item.created_at);
        const prefix = rangeLabel ? `${rangeLabel} • ` : "";
        return {
          value: item.plan_id,
          label: `${prefix}作成 ${createdLabel}`,
        };
      }),
    [planOptions],
  );

  const isPlanListLoading = transferPlansQuery.isLoading || transferPlansQuery.isFetching;
  const hasPlanOptions = planOptions.length > 0;
  const isLoadPlanDisabled = !selectedPlanId || loadPlanMutation.isPending;

  useEffect(() => {
    if (!selectedPlanId) {
      return;
    }
    if (!planOptions.some((plan) => plan.plan_id === selectedPlanId)) {
      setSelectedPlanId("");
    }
  }, [planOptions, selectedPlanId]);

  const baseMatrixRows: MatrixRow[] = matrixQuery.data ?? [];

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
      const move = baseMove - savedMove + draftMove;
      const stock_closing = baseRow?.stock_closing ?? 0;
      const stock_fin = stock_closing + move;
      const stock_at_anchor = baseRow?.stock_at_anchor ?? 0;
      const inbound_qty = baseRow?.inbound_qty ?? 0;
      const outbound_qty = baseRow?.outbound_qty ?? 0;
      const stdstock = baseRow?.stdstock ?? 0;
      const gap = baseRow?.gap ?? stock_at_anchor - stdstock;
      const sku_name = baseRow?.sku_name ?? skuNameMap.get(sku_code) ?? null;
      result.push({
        sku_code,
        sku_name,
        warehouse_name,
        channel,
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
  }, [baseMatrixRows, baselineMoveMap, draftMoveMap, skuNameMap]);

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

  const skuList = useMemo(
    () => Array.from(new Set(simulatedMatrixRows.map((row) => row.sku_code))),
    [simulatedMatrixRows],
  );

  const psiRows = useMemo(
    () =>
      simulatedMatrixRows.map((row) => ({
        sku: row.sku_code,
        skuName: row.sku_name ?? undefined,
        warehouse: row.warehouse_name,
        channel: row.channel,
        stockStart: row.stock_at_anchor,
        inbound: row.inbound_qty,
        outbound: row.outbound_qty,
        stockClosing: row.stock_closing,
        stdStock: row.stdstock,
        gap: row.gap,
        move: row.move,
        stockFinal: row.stock_fin,
        gapAfter: row.stock_fin - row.stdstock,
      })),
    [simulatedMatrixRows],
  );

  return (
    <div className="page reallocation-page">
      <h1>在庫再配置</h1>

      <form className="reallocation-filter-form" onSubmit={handleApplyFilters}>
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
            <label>
              作成済みプラン
              <select
                value={selectedPlanId}
                onChange={(event) => setSelectedPlanId(event.target.value)}
                disabled={!hasPlanOptions || isPlanListLoading}
              >
                <option value="">Select plan</option>
                {planSelectOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            {isPlanListLoading && (
              <p className="reallocation-filter-status">Loading saved plans…</p>
            )}
            {transferPlansQuery.isError && (
              <p className="reallocation-filter-status error">Failed to load saved plans.</p>
            )}
            {!isPlanListLoading && !hasPlanOptions && (
              <p className="reallocation-filter-status">No saved plans match the selected filters.</p>
            )}
          </div>
        </div>
        <div className="reallocation-filter-actions">
          <button type="submit" disabled={matrixQuery.isFetching}>
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

      {status && <div className={`status-message ${status.type}`}>{status.text}</div>}

      <section className="matrix-section">
        <h2>PSI Matrix</h2>
        {matrixQuery.isLoading && <p>Loading matrix…</p>}
        {matrixQuery.isError && !matrixQuery.isLoading && (
          <p className="error-text">Failed to load matrix data.</p>
        )}
        {!matrixQuery.isLoading && simulatedMatrixRows.length === 0 && (
          <p>No data for the selected filters.</p>
        )}
        {simulatedMatrixRows.length > 0 && <PSIMatrixTabs data={psiRows} skuList={skuList} />}
      </section>

      <section className="plan-lines-section">
        <div className="plan-header">
          <h2>Transfer Plan Lines</h2>
          <div className="plan-actions">
            <button type="button" onClick={handleAddLine} disabled={!plan}>
              Add manual line
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={!plan || !planDirty || saveLinesMutation.isPending}
            >
              {saveLinesMutation.isPending ? "Saving…" : "Save lines"}
            </button>
          </div>
        </div>
        {!plan && <p>No plan loaded. Create a recommendation to begin.</p>}
        {plan && (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
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
                {lines.map((line) => {
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

                  return (
                    <tr key={line.line_id}>
                      <td>
                        <input
                          list={skuDatalistId}
                          value={line.sku_code}
                          onChange={(event) =>
                            handleLineChange(line.line_id, { sku_code: event.target.value })
                          }
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
                          step="0.000001"
                          min="0"
                          value={line.qty}
                          onChange={(event) =>
                            handleLineChange(line.line_id, { qty: event.target.value })
                          }
                        />
                      </td>
                      <td className="checkbox-cell">
                        <input
                          type="checkbox"
                          checked={line.is_manual}
                          onChange={(event) =>
                            handleLineChange(line.line_id, { is_manual: event.target.checked })
                          }
                        />
                      </td>
                      <td>
                        <input
                          value={line.reason}
                          onChange={(event) =>
                            handleLineChange(line.line_id, { reason: event.target.value })
                          }
                        />
                      </td>
                      <td>
                        <button type="button" onClick={() => handleRemoveLine(line.line_id)}>
                          Remove
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <datalist id={skuDatalistId}>
              {skuOptions.map((option) => (
                <option key={option.code} value={option.code}>
                  {option.name ? `${option.code} — ${option.name}` : option.code}
                </option>
              ))}
            </datalist>
          </div>
        )}
      </section>
    </div>
  );
}
