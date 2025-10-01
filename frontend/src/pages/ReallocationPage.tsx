import { FormEvent, useEffect, useMemo, useState } from "react";
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

const formatNumber = (value: number) =>
  Number.isFinite(value)
    ? value.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })
    : "-";

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
  const [status, setStatus] = useState<StatusMessage | null>(null);
  const [baseFilters, setBaseFilters] = useState<Omit<MatrixQueryArgs, "planId"> | null>(null);
  const [planDirty, setPlanDirty] = useState(false);
  const [selectedSkuIndex, setSelectedSkuIndex] = useState(0);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");

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
    setPlanDirty(false);
    setSelectedPlanId("");
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
      setLines(response.lines.map(toDraftLine));
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
      setLines(
        payload.map((line) => ({
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
        })),
      );
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

  const handleLoadPlan = async () => {
    if (!selectedPlanId) {
      return;
    }
    setStatus(null);
    try {
      const response = await loadPlanMutation.mutateAsync(selectedPlanId);
      const loadedPlan = response.plan;
      if (loadedPlan.session_id !== selectedSessionId) {
        setSelectedSessionId(loadedPlan.session_id);
      }
      setSelectedPlanId(loadedPlan.plan_id);
      setStartDate(loadedPlan.start_date);
      setEndDate(loadedPlan.end_date);
      setPlan(loadedPlan);
      setLines(response.lines.map(toDraftLine));
      setPlanDirty(false);
      setBaseFilters({
        sessionId: loadedPlan.session_id,
        start: loadedPlan.start_date,
        end: loadedPlan.end_date,
      });
      setStatus({ type: "success", text: "Plan loaded." });
    } catch (error) {
      setStatus({
        type: "error",
        text: getErrorMessage(error, "Failed to load plan."),
      });
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

  const matrixRows: MatrixRow[] = matrixQuery.data ?? [];
  const skuList = useMemo(
    () => Array.from(new Set(matrixRows.map((row) => row.sku_code))),
    [matrixRows],
  );
  const skuCount = skuList.length;

  const skuListKey = skuList.join("|");

  useEffect(() => {
    setSelectedSkuIndex(0);
  }, [skuListKey]);

  useEffect(() => {
    if (selectedSkuIndex >= skuCount && skuCount > 0) {
      setSelectedSkuIndex(skuCount - 1);
    }
  }, [selectedSkuIndex, skuCount]);

  const selectedSku = skuList[selectedSkuIndex] ?? null;
  const displayedRows = selectedSku
    ? matrixRows.filter((row) => row.sku_code === selectedSku)
    : matrixRows;

  const handlePrevSku = () => {
    setSelectedSkuIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextSku = () => {
    setSelectedSkuIndex((prev) => (skuCount === 0 ? 0 : Math.min(skuCount - 1, prev + 1)));
  };

  return (
    <div className="page reallocation-page">
      <h1>在庫再配置</h1>

      <form className="filters" onSubmit={handleApplyFilters}>
        <div className="psi-filter-grid">
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
        <div className="filter-actions">
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
        </div>
      </form>

      <section className="existing-plans">
        <h2>保存済みの再配置計画</h2>
        <div className="existing-plans__controls">
          <label className="existing-plans__label">
            作成済みプラン
            <select
              className="existing-plans__select"
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
        {isPlanListLoading && <p className="existing-plans__status">Loading saved plans…</p>}
        {transferPlansQuery.isError && (
          <p className="existing-plans__status existing-plans__status--error">
            Failed to load saved plans.
          </p>
        )}
        {!isPlanListLoading && !hasPlanOptions && (
          <p className="existing-plans__status">No saved plans match the selected filters.</p>
        )}
      </section>

      {status && <div className={`status-message ${status.type}`}>{status.text}</div>}

      <section className="matrix-section">
        <h2>PSI Matrix</h2>
        {matrixQuery.isLoading && <p>Loading matrix…</p>}
        {matrixQuery.isError && !matrixQuery.isLoading && (
          <p className="error-text">Failed to load matrix data.</p>
        )}
        {!matrixQuery.isLoading && matrixRows.length === 0 && (
          <p>No data for the selected filters.</p>
        )}
        {matrixRows.length > 0 && (
          <div className="table-wrapper">
            <div className="sku-navigation">
              <button
                type="button"
                onClick={handlePrevSku}
                disabled={selectedSkuIndex <= 0}
              >
                前のSKU
              </button>
              <span className="sku-indicator">
                {selectedSku ? `${selectedSkuIndex + 1} / ${skuList.length} : ${selectedSku}` : "-"}
              </span>
              <button
                type="button"
                onClick={handleNextSku}
                disabled={skuCount === 0 || selectedSkuIndex >= skuCount - 1}
              >
                次のSKU
              </button>
            </div>
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>SKU Name</th>
                  <th>Warehouse</th>
                  <th>Channel</th>
                  <th>Stock @ Start</th>
                  <th>Inbound</th>
                  <th>Outbound</th>
                  <th>Stock Closing</th>
                  <th>Std Stock</th>
                  <th>Gap</th>
                  <th>Move</th>
                  <th>Stock Final</th>
                  <th>Gap After</th>
                </tr>
              </thead>
              <tbody>
                {displayedRows.map((row) => {
                  const gapAfter = row.stock_fin - row.stdstock;
                  return (
                    <tr key={`${row.sku_code}|${row.warehouse_name}|${row.channel}`}>
                      <td>{row.sku_code}</td>
                      <td>{row.sku_name ?? "-"}</td>
                      <td>{row.warehouse_name}</td>
                      <td>{row.channel}</td>
                      <td>{formatNumber(row.stock_at_anchor)}</td>
                      <td>{formatNumber(row.inbound_qty)}</td>
                      <td>{formatNumber(row.outbound_qty)}</td>
                      <td>{formatNumber(row.stock_closing)}</td>
                      <td>{formatNumber(row.stdstock)}</td>
                      <td>{formatNumber(row.gap)}</td>
                      <td>{formatNumber(row.move)}</td>
                      <td>{formatNumber(row.stock_fin)}</td>
                      <td style={{ color: gapAfter < 0 ? "#c0392b" : undefined }}>
                        {formatNumber(gapAfter)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
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
                {lines.map((line) => (
                  <tr key={line.line_id}>
                    <td>
                      <input
                        value={line.sku_code}
                        onChange={(event) =>
                          handleLineChange(line.line_id, { sku_code: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        value={line.from_warehouse}
                        onChange={(event) =>
                          handleLineChange(line.line_id, { from_warehouse: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        value={line.from_channel}
                        onChange={(event) =>
                          handleLineChange(line.line_id, { from_channel: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        value={line.to_warehouse}
                        onChange={(event) =>
                          handleLineChange(line.line_id, { to_warehouse: event.target.value })
                        }
                      />
                    </td>
                    <td>
                      <input
                        value={line.to_channel}
                        onChange={(event) =>
                          handleLineChange(line.line_id, { to_channel: event.target.value })
                        }
                      />
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
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
