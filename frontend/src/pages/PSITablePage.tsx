import { useEffect, useMemo, useState } from "react";
import axios from "axios";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { api } from "../lib/api";
import { PSIChannel, PSIDailyEntry, Session } from "../types";

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
): Promise<PSIChannel[]> => {
  const params: Record<string, string> = {};
  if (filters.sku_code?.trim()) params.sku_code = filters.sku_code.trim();
  if (filters.warehouse_name?.trim()) params.warehouse_name = filters.warehouse_name.trim();
  if (filters.channel?.trim()) params.channel = filters.channel.trim();

  const { data } = await api.get<PSIChannel[]>(`/psi/${sessionId}/daily`, {
    params,
  });
  return data;
};

const numberFormatter = new Intl.NumberFormat("ja-JP", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const dateFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
});

const formatNumber = (value?: number | null) => {
  if (value === null || value === undefined) return "—";
  return numberFormatter.format(value);
};

const parseDate = (iso: string) => new Date(`${iso}T00:00:00`);
const compareDateStrings = (a: string, b: string) => parseDate(a).getTime() - parseDate(b).getTime();

const formatDisplayDate = (iso: string) => dateFormatter.format(parseDate(iso));

type MetricKey =
  | "stock_at_anchor"
  | "inbound_qty"
  | "outbound_qty"
  | "net_flow"
  | "stock_closing"
  | "safety_stock"
  | "movable_stock";

type EditableField = "inbound_qty" | "outbound_qty" | "safety_stock";

interface PSIEditableDay extends PSIDailyEntry {
  base_stock_at_anchor: number | null;
}

interface PSIEditableChannel extends Omit<PSIChannel, "daily"> {
  daily: PSIEditableDay[];
}

interface MetricDefinitionBase {
  key: MetricKey;
  label: string;
  editable?: false;
}

interface EditableMetricDefinition {
  key: EditableField;
  label: string;
  editable: true;
}

type MetricDefinition = MetricDefinitionBase | EditableMetricDefinition;

const metricDefinitions: MetricDefinition[] = [
  { key: "stock_at_anchor", label: "stock_at_anchor" },
  { key: "inbound_qty", label: "inbound_qty", editable: true },
  { key: "outbound_qty", label: "outbound_qty", editable: true },
  { key: "net_flow", label: "net_flow" },
  { key: "stock_closing", label: "stock_closing" },
  { key: "safety_stock", label: "safety_stock", editable: true },
  { key: "movable_stock", label: "movable_stock" },
];

const isEditableMetric = (metric: MetricDefinition): metric is EditableMetricDefinition => metric.editable === true;

const sortDailyEntries = (daily: PSIDailyEntry[]): PSIEditableDay[] =>
  [...daily]
    .sort((a, b) => compareDateStrings(a.date, b.date))
    .map((entry) => ({
      ...entry,
      base_stock_at_anchor: entry.stock_at_anchor ?? null,
    }));

const recomputeChannel = (channel: PSIEditableChannel): PSIEditableChannel => {
  let previousClosing: number | null = null;

  const recalculated = channel.daily.map((entry, index) => {
    const baseAnchor = entry.base_stock_at_anchor;
    const effectiveAnchor = index === 0 ? baseAnchor : previousClosing ?? baseAnchor;

    const inbound = entry.inbound_qty ?? 0;
    const outbound = entry.outbound_qty ?? 0;
    const netFlow = inbound - outbound;

    const anchorValue = effectiveAnchor ?? 0;
    const shouldKeepNull = effectiveAnchor === null && inbound === 0 && outbound === 0;
    const stockClosing = shouldKeepNull ? null : anchorValue + netFlow;

    const safety = entry.safety_stock ?? 0;
    const movableStock = stockClosing === null ? null : stockClosing - safety;

    previousClosing = stockClosing;

    return {
      ...entry,
      stock_at_anchor: effectiveAnchor,
      net_flow: netFlow,
      stock_closing: stockClosing,
      movable_stock: movableStock,
    };
  });

  return {
    ...channel,
    daily: recalculated,
  };
};

const prepareEditableData = (data: PSIChannel[]): PSIEditableChannel[] =>
  data.map((channel) =>
    recomputeChannel({
      ...channel,
      daily: sortDailyEntries(channel.daily),
    })
  );

const makeChannelKey = (channel: { sku_code: string; warehouse_name: string; channel: string }) =>
  `${channel.sku_code}__${channel.warehouse_name}__${channel.channel}`;

export default function PSITablePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessionId, setSessionId] = useState<string>(() => searchParams.get("sessionId") ?? "");
  const [skuCode, setSkuCode] = useState<string>("");
  const [warehouseName, setWarehouseName] = useState<string>("");
  const [channel, setChannel] = useState<string>("");
  const [tableData, setTableData] = useState<PSIEditableChannel[]>([]);

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

  useEffect(() => {
    if (psiQuery.data) {
      setTableData(prepareEditableData(psiQuery.data));
    } else {
      setTableData([]);
    }
  }, [psiQuery.data]);

  const allDates = useMemo(() => {
    const dateSet = new Set<string>();
    tableData.forEach((item) => {
      item.daily.forEach((entry) => {
        dateSet.add(entry.date);
      });
    });
    return Array.from(dateSet).sort(compareDateStrings);
  }, [tableData]);

  const handleEditableChange = (channelKey: string, date: string, field: EditableField, rawValue: string) => {
    setTableData((previous) =>
      previous.map((item) => {
        if (makeChannelKey(item) !== channelKey) {
          return item;
        }

        const updatedDaily = item.daily.map((entry) => {
          if (entry.date !== date) {
            return entry;
          }

          if (rawValue === "") {
            return { ...entry, [field]: null };
          }

          const parsed = Number(rawValue);
          if (!Number.isFinite(parsed)) {
            return entry;
          }

          return { ...entry, [field]: parsed };
        });

        return recomputeChannel({ ...item, daily: updatedDaily });
      })
    );
  };

  const handleReset = () => {
    if (psiQuery.data) {
      setTableData(prepareEditableData(psiQuery.data));
    }
  };

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
        <div className="actions">
          <button type="button" onClick={() => psiQuery.refetch()} disabled={!sessionId || psiQuery.isFetching}>
            Refresh
          </button>
          <button type="button" onClick={handleReset} disabled={!psiQuery.data}>
            Reset Table
          </button>
        </div>

        {psiQuery.isLoading && sessionId && <p>Loading PSI data...</p>}
        {psiQuery.isError && <p className="error">{getErrorMessage(psiQuery.error, "Unable to load PSI data.")}</p>}
        {tableData.length > 0 ? (
          <div className="psi-table-container">
            <table className="psi-table">
              <thead>
                <tr>
                  <th className="sticky-col col-sku">sku_code</th>
                  <th className="sticky-col col-sku-name">sku_name</th>
                  <th className="sticky-col col-warehouse">warehouse_name</th>
                  <th className="sticky-col col-channel">channel</th>
                  <th className="sticky-col col-div">div</th>
                  {allDates.map((date) => (
                    <th key={date} className="date-header">
                      {formatDisplayDate(date)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {tableData.map((item) => {
                  const channelKey = makeChannelKey(item);
                  const rowSpan = metricDefinitions.length;
                  const dateMap = new Map(item.daily.map((entry) => [entry.date, entry]));

                  return metricDefinitions.map((metric, metricIndex) => (
                    <tr key={`${channelKey}-${metric.key}`}>
                      {metricIndex === 0 && (
                        <>
                          <td className="sticky-col col-sku" rowSpan={rowSpan}>
                            {item.sku_code}
                          </td>
                          <td className="sticky-col col-sku-name" rowSpan={rowSpan}>
                            {item.sku_name ?? "—"}
                          </td>
                          <td className="sticky-col col-warehouse" rowSpan={rowSpan}>
                            {item.warehouse_name}
                          </td>
                          <td className="sticky-col col-channel" rowSpan={rowSpan}>
                            {item.channel}
                          </td>
                        </>
                      )}
                      <td className="sticky-col col-div psi-metric-name">{metric.label}</td>
                      {allDates.map((date) => {
                        const entry = dateMap.get(date);
                        const cellKey = `${channelKey}-${metric.key}-${date}`;

                        if (!entry) {
                          return (
                            <td key={cellKey} className="numeric">
                              —
                            </td>
                          );
                        }

                        const value = entry[metric.key];

                        if (isEditableMetric(metric)) {
                          return (
                            <td key={cellKey} className="numeric">
                              <input
                                type="number"
                                className="psi-edit-input"
                                value={value ?? ""}
                                onChange={(event) => handleEditableChange(channelKey, date, metric.key, event.target.value)}
                                step="0.01"
                                inputMode="decimal"
                              />
                            </td>
                          );
                        }

                        return (
                          <td key={cellKey} className="numeric">
                            {formatNumber(value)}
                          </td>
                        );
                      })}
                    </tr>
                  ));
                })}
              </tbody>
            </table>
          </div>
        ) : (
          sessionId && !psiQuery.isLoading && <p>No PSI data for the current filters.</p>
        )}
      </section>
    </div>
  );
}
