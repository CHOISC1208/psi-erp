import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { api } from "../lib/api";
import { PSIRow, Session } from "../types";

const fetchSessions = async (): Promise<Session[]> => {
  const { data } = await api.get<Session[]>("/sessions");
  return data;
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
  const [sessionId, setSessionId] = useState<string>("");
  const [skuCode, setSkuCode] = useState<string>("");
  const [warehouseName, setWarehouseName] = useState<string>("");
  const [channel, setChannel] = useState<string>("");

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
  });

  useEffect(() => {
    if (!sessionId && sessionsQuery.data && sessionsQuery.data.length > 0) {
      setSessionId(sessionsQuery.data[0].id);
    }
  }, [sessionId, sessionsQuery.data]);

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
        <div className="form-grid">
          <label>
            Session
            <select value={sessionId} onChange={(event) => setSessionId(event.target.value)} disabled={sessionsQuery.isLoading}>
              <option value="" disabled>
                Select a session
              </option>
              {sessionsQuery.data?.map((session) => (
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
        {sessionsQuery.isError && <p className="error">Unable to load sessions.</p>}
      </section>

      <section>
        {psiQuery.isLoading && sessionId && <p>Loading PSI data...</p>}
        {psiQuery.isError && <p className="error">Unable to load PSI data.</p>}
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
