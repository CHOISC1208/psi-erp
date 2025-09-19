import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { api } from "../lib/api";
import { PSIRow, Session } from "../types";

const fetchSessions = async (): Promise<Session[]> => {
  const { data } = await api.get<Session[]>("/sessions/");
  return data;
};

const getErrorMessage = (error: unknown, fallback: string) => {
  if (axios.isAxiosError(error)) {
    const detail = (error.response?.data as { detail?: string } | undefined)?.detail;
    if (detail) {
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

const fetchDailyPsi = async (
  sessionId: string,
  filters: { sku_code?: string; warehouse_name?: string; channel?: string }
): Promise<PSIRow[]> => {
  const params: Record<string, string> = {};
  if (filters.sku_code?.trim()) params.sku_code = filters.sku_code.trim();
  if (filters.warehouse_name?.trim()) params.warehouse_name = filters.warehouse_name.trim();
  if (filters.channel?.trim()) params.channel = filters.channel.trim();

  const { data } = await api.get<PSIRow[]>(`/psi/${sessionId}/daily`, {
    params,
  });
  return data;
};

const formatNumber = (value?: number | null) => {
  if (value === null || value === undefined) return "—";
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
};

export default function PSITablePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessionId, setSessionId] = useState<string>(() => searchParams.get("sessionId") ?? "");
  const [skuCode, setSkuCode] = useState<string>("");
  const [warehouseName, setWarehouseName] = useState<string>("");
  const [channel, setChannel] = useState<string>("");

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
  });

  const availableSessions = sessionsQuery.data ?? [];
  const leaderSession = useMemo(
    () => availableSessions.find((session) => session.is_leader),
    [availableSessions]
  );

  useEffect(() => {
    const paramSessionId = searchParams.get("sessionId") ?? "";
    if (paramSessionId && paramSessionId !== sessionId) {
      setSessionId(paramSessionId);
    }
  }, [searchParams, sessionId]);

  useEffect(() => {
    if (!availableSessions.length) {
      return;
    }

    if (sessionId) {
      const isValid = availableSessions.some((session) => session.id === sessionId);
      if (!isValid) {
        const fallback = leaderSession ?? availableSessions[0];
        setSessionId(fallback.id);
        if ((searchParams.get("sessionId") ?? "") !== fallback.id) {
          const params = new URLSearchParams(searchParams);
          params.set("sessionId", fallback.id);
          setSearchParams(params, { replace: true });
        }
      }
      return;
    }

    const fallback = leaderSession ?? availableSessions[0];
    if (fallback) {
      setSessionId(fallback.id);
      if ((searchParams.get("sessionId") ?? "") !== fallback.id) {
        const params = new URLSearchParams(searchParams);
        params.set("sessionId", fallback.id);
        setSearchParams(params, { replace: true });
      }
    }
  }, [availableSessions, leaderSession, searchParams, sessionId, setSearchParams]);

  const handleSessionChange = (value: string) => {
    setSessionId(value);
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("sessionId", value);
    } else {
      params.delete("sessionId");
    }
    setSearchParams(params);
  };

  const psiQuery = useQuery({
    queryKey: ["psi-daily", sessionId, skuCode, warehouseName, channel],
    queryFn: () => fetchDailyPsi(sessionId, { sku_code: skuCode, warehouse_name: warehouseName, channel }),
    enabled: Boolean(sessionId),
  });

  return (
    <div className="page">
      <header>
        <h1>PSI Daily Table</h1>
        <p>Review the computed PSI metrics for the selected session.</p>
      </header>

      <section>
        <div className="filters-row">
          <label>
            Session
            <select
              value={sessionId}
              onChange={(event) => handleSessionChange(event.target.value)}
              disabled={sessionsQuery.isLoading}
            >
              <option value="" disabled>
                Select a session
              </option>
              {availableSessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title}
                </option>
              ))}
            </select>
          </label>

          <label>
            SKU Code
            <input type="text" value={skuCode} onChange={(event) => setSkuCode(event.target.value)} placeholder="Optional" />
          </label>

          <label>
            Warehouse
            <input
              type="text"
              value={warehouseName}
              onChange={(event) => setWarehouseName(event.target.value)}
              placeholder="Optional"
            />
          </label>

          <label>
            Channel
            <input type="text" value={channel} onChange={(event) => setChannel(event.target.value)} placeholder="Optional" />
          </label>
        </div>

        {sessionsQuery.isLoading && <p>Loading sessions...</p>}
        {sessionsQuery.isError && (
          <p className="error">{getErrorMessage(sessionsQuery.error, "Unable to load sessions.")}</p>
        )}
      </section>

      <section>
        {psiQuery.isLoading && sessionId && <p>Loading PSI data...</p>}
        {psiQuery.isError && <p className="error">{getErrorMessage(psiQuery.error, "Unable to load PSI data.")}</p>}
        {psiQuery.data && psiQuery.data.length > 0 ? (
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Stock @ Anchor</th>
                <th>Inbound Qty</th>
                <th>Outbound Qty</th>
                <th>Net Flow</th>
                <th>Stock Closing</th>
                <th>Safety Stock</th>
                <th>Movable Stock</th>
              </tr>
            </thead>
            <tbody>
              {psiQuery.data.map((row) => (
                <tr key={row.date}>
                  <td>{new Date(row.date).toLocaleDateString()}</td>
                  <td className="numeric">{formatNumber(row.stock_at_anchor)}</td>
                  <td className="numeric">{formatNumber(row.inbound_qty)}</td>
                  <td className="numeric">{formatNumber(row.outbound_qty)}</td>
                  <td className="numeric">{formatNumber(row.net_flow)}</td>
                  <td className="numeric">{formatNumber(row.stock_closing)}</td>
                  <td className="numeric">{formatNumber(row.safety_stock)}</td>
                  <td className="numeric">{formatNumber(row.movable_stock)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          sessionId && !psiQuery.isLoading && <p>No PSI data for the current filters.</p>
        )}
      </section>
    </div>
  );
}
