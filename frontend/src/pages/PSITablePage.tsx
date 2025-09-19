import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { api } from "../lib/api";
import { PSIChannel, PSIDailyEntry, PSIEditApplyResult, PSISessionSummary, Session } from "../types";

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

const fetchSessionSummary = async (sessionId: string): Promise<PSISessionSummary> => {
  const { data } = await api.get<PSISessionSummary>(`/psi/${sessionId}/summary`);
  return data;
};

interface PSIEditUpdatePayload {
  sku_code: string;
  warehouse_name: string;
  channel: string;
  date: string;
  inbound_qty?: number | null;
  outbound_qty?: number | null;
  safety_stock?: number | null;
}

const applyPsiEdits = async (
  sessionId: string,
  edits: PSIEditUpdatePayload[]
): Promise<PSIEditApplyResult> => {
  const { data } = await api.post<PSIEditApplyResult>(`/psi/${sessionId}/edits/apply`, { edits });
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

const dateTimeFormatter = new Intl.DateTimeFormat("ja-JP", {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const formatNumber = (value?: number | null) => {
  if (value === null || value === undefined) return "—";
  return numberFormatter.format(value);
};

const parseDate = (iso: string) => new Date(`${iso}T00:00:00`);
const compareDateStrings = (a: string, b: string) => parseDate(a).getTime() - parseDate(b).getTime();

const formatDisplayDate = (iso: string) => dateFormatter.format(parseDate(iso));
const formatDisplayDateTime = (iso: string) => dateTimeFormatter.format(new Date(iso));

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

const cloneEditableChannels = (channels: PSIEditableChannel[]): PSIEditableChannel[] =>
  channels.map((channel) => ({
    ...channel,
    daily: channel.daily.map((entry) => ({ ...entry })),
  }));

const makeCellKey = (channelKey: string, date: string) => `${channelKey}__${date}`;

const valuesEqual = (a: number | null | undefined, b: number | null | undefined) => {
  if (a === null || a === undefined) {
    return b === null || b === undefined;
  }
  if (b === null || b === undefined) {
    return false;
  }
  return Math.abs(a - b) < 1e-9;
};

export default function PSITablePage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [sessionId, setSessionId] = useState<string>(() => searchParams.get("sessionId") ?? "");
  const [skuCode, setSkuCode] = useState<string>("");
  const [warehouseName, setWarehouseName] = useState<string>("");
  const [channel, setChannel] = useState<string>("");
  const [tableData, setTableData] = useState<PSIEditableChannel[]>([]);
  const [baselineData, setBaselineData] = useState<PSIEditableChannel[]>([]);
  const [isApplying, setIsApplying] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [applySuccess, setApplySuccess] = useState<string | null>(null);
  const [descriptionDraft, setDescriptionDraft] = useState<string>("");
  const [originalDescription, setOriginalDescription] = useState<string>("");
  const [descriptionError, setDescriptionError] = useState<string | null>(null);
  const [descriptionSaved, setDescriptionSaved] = useState(false);
  const [isSavingDescription, setIsSavingDescription] = useState(false);
  const [controlsCollapsed, setControlsCollapsed] = useState(false);
  const [lastAppliedAt, setLastAppliedAt] = useState<string | null>(null);
  const [visibleMetricKeys, setVisibleMetricKeys] = useState<MetricKey[]>(() =>
    metricDefinitions.map((metric) => metric.key as MetricKey)
  );
  const [isMetricSelectorOpen, setIsMetricSelectorOpen] = useState(false);
  const metricSelectorRef = useRef<HTMLDivElement | null>(null);

  const sessionsQuery = useQuery({
    queryKey: ["sessions"],
    queryFn: fetchSessions,
  });

  const availableSessions = sessionsQuery.data ?? [];
  const leaderSession = useMemo(
    () => availableSessions.find((session) => session.is_leader),
    [availableSessions]
  );
  const selectedSession = useMemo(
    () => availableSessions.find((session) => session.id === sessionId) ?? null,
    [availableSessions, sessionId]
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
    setApplyError(null);
    setApplySuccess(null);
    setDescriptionError(null);
    setDescriptionSaved(false);
    setLastAppliedAt(null);
    setIsMetricSelectorOpen(false);
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

  const sessionSummaryQuery = useQuery({
    queryKey: ["psi-session-summary", sessionId],
    queryFn: () => fetchSessionSummary(sessionId),
    enabled: Boolean(sessionId),
  });

  useEffect(() => {
    if (psiQuery.data) {
      const prepared = prepareEditableData(psiQuery.data);
      const cloned = cloneEditableChannels(prepared);
      setBaselineData(cloned);
      setTableData(cloneEditableChannels(prepared));
    } else {
      setBaselineData([]);
      setTableData([]);
    }
    setApplyError(null);
    setApplySuccess(null);
  }, [psiQuery.data]);

  useEffect(() => {
    if (selectedSession) {
      const description = selectedSession.description ?? "";
      setDescriptionDraft(description);
      setOriginalDescription(description);
    } else {
      setDescriptionDraft("");
      setOriginalDescription("");
    }
    setDescriptionError(null);
    setDescriptionSaved(false);
  }, [selectedSession]);

  useEffect(() => {
    setLastAppliedAt(null);
  }, [sessionId]);

  useEffect(() => {
    if (controlsCollapsed) {
      setIsMetricSelectorOpen(false);
    }
  }, [controlsCollapsed]);

  useEffect(() => {
    if (!isMetricSelectorOpen) {
      return;
    }

    const handleClickOutside = (event: MouseEvent) => {
      if (!metricSelectorRef.current) {
        return;
      }
      if (!metricSelectorRef.current.contains(event.target as Node)) {
        setIsMetricSelectorOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isMetricSelectorOpen]);

  const allDates = useMemo(() => {
    const dateSet = new Set<string>();
    tableData.forEach((item) => {
      item.daily.forEach((entry) => {
        dateSet.add(entry.date);
      });
    });
    return Array.from(dateSet).sort(compareDateStrings);
  }, [tableData]);

  const visibleMetrics = useMemo(
    () => metricDefinitions.filter((metric) => visibleMetricKeys.includes(metric.key as MetricKey)),
    [visibleMetricKeys]
  );

  const baselineMap = useMemo(() => {
    const map = new Map<string, PSIEditableDay>();
    baselineData.forEach((item) => {
      const channelKey = makeChannelKey(item);
      item.daily.forEach((entry) => {
        map.set(makeCellKey(channelKey, entry.date), entry);
      });
    });
    return map;
  }, [baselineData]);

  const pendingEdits = useMemo(() => {
    const edits: PSIEditUpdatePayload[] = [];

    tableData.forEach((item) => {
      const channelKey = makeChannelKey(item);

      item.daily.forEach((entry) => {
        const baselineEntry = baselineMap.get(makeCellKey(channelKey, entry.date));
        let changed = false;
        const diff: PSIEditUpdatePayload = {
          sku_code: item.sku_code,
          warehouse_name: item.warehouse_name,
          channel: item.channel,
          date: entry.date,
        };

        (["inbound_qty", "outbound_qty", "safety_stock"] as EditableField[]).forEach((field) => {
          const currentValue = entry[field] ?? null;
          const baselineValue = baselineEntry ? baselineEntry[field] ?? null : null;
          if (!valuesEqual(currentValue, baselineValue)) {
            diff[field] = currentValue;
            changed = true;
          }
        });

        if (changed) {
          edits.push(diff);
        }
      });
    });

    return edits;
  }, [baselineMap, tableData]);

  const hasPendingChanges = pendingEdits.length > 0;
  const isDescriptionDirty = descriptionDraft !== originalDescription;
  const summaryData = sessionSummaryQuery.data;
  const formattedStart = summaryData?.start_date ? formatDisplayDate(summaryData.start_date) : "—";
  const formattedEnd = summaryData?.end_date ? formatDisplayDate(summaryData.end_date) : "—";
  const formattedCreatedAt = selectedSession?.created_at ? formatDisplayDateTime(selectedSession.created_at) : "—";
  const formattedUpdatedAt = lastAppliedAt
    ? formatDisplayDateTime(lastAppliedAt)
    : selectedSession?.updated_at
      ? formatDisplayDateTime(selectedSession.updated_at)
      : "—";

  const toggleMetricVisibility = (metricKey: MetricKey) => {
    setVisibleMetricKeys((previous) => {
      if (previous.includes(metricKey)) {
        if (previous.length === 1) {
          return previous;
        }
        return previous.filter((key) => key !== metricKey);
      }
      return [...previous, metricKey];
    });
  };

  const handleDownload = () => {
    if (
      !tableData.length ||
      !visibleMetrics.length ||
      typeof window === "undefined" ||
      typeof document === "undefined"
    ) {
      return;
    }

    const header = [
      "sku_code",
      "sku_name",
      "warehouse_name",
      "channel",
      "metric",
      ...allDates.map((date) => formatDisplayDate(date)),
    ];

    const rows = tableData.flatMap((item) => {
      const dateMap = new Map(item.daily.map((entry) => [entry.date, entry]));

      return visibleMetrics.map((metric) => {
        const values = allDates.map((date) => {
          const entry = dateMap.get(date);
          if (!entry) {
            return "";
          }
          const value = entry[metric.key];
          if (value === null || value === undefined) {
            return "";
          }
          if (typeof value === "number") {
            return formatNumber(value);
          }
          return String(value);
        });

        return [
          item.sku_code,
          item.sku_name ?? "",
          item.warehouse_name,
          item.channel,
          metric.label,
          ...values,
        ];
      });
    });

    const csvContent = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    link.download = `psi-daily-${sessionId || "all"}-${timestamp}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handleEditableChange = (channelKey: string, date: string, field: EditableField, rawValue: string) => {
    setApplyError(null);
    setApplySuccess(null);
    setTableData((previous) =>
      previous.map((item) => {
        if (makeChannelKey(item) !== channelKey) {
          return item;
        }

        const updatedDaily = item.daily.map((entry) => {
          if (entry.date !== date) {
            return entry;
          }

          const trimmed = rawValue.trim();
          if (trimmed === "") {
            return { ...entry, [field]: null };
          }

          const parsed = Number(trimmed);
          if (!Number.isFinite(parsed)) {
            return entry;
          }

          return { ...entry, [field]: parsed };
        });

        return recomputeChannel({ ...item, daily: updatedDaily });
      })
    );
  };

  const handlePasteValues = useCallback(
    (channelKey: string, date: string, field: EditableField, clipboardText: string) => {
      if (!clipboardText) {
        return;
      }

      const startIndex = allDates.indexOf(date);
      if (startIndex === -1) {
        return;
      }

      const values = clipboardText
        .replace(/\r/g, "")
        .split(/\n/)
        .flatMap((row) => row.split(/\t/))
        .map((token) => token.trim());

      if (!values.length) {
        return;
      }

      setApplyError(null);
      setApplySuccess(null);

      setTableData((previous) =>
        previous.map((item) => {
          if (makeChannelKey(item) !== channelKey) {
            return item;
          }

          const updatedDaily = item.daily.map((entry) => ({ ...entry }));
          let pointer = startIndex;

          values.forEach((token) => {
            if (pointer >= allDates.length) {
              return;
            }

            const targetDate = allDates[pointer];
            pointer += 1;

            const entryIndex = updatedDaily.findIndex((dailyEntry) => dailyEntry.date === targetDate);
            if (entryIndex === -1) {
              return;
            }

            if (token === "") {
              updatedDaily[entryIndex] = { ...updatedDaily[entryIndex], [field]: null };
              return;
            }

            const parsed = Number(token);
            if (!Number.isFinite(parsed)) {
              return;
            }

            updatedDaily[entryIndex] = { ...updatedDaily[entryIndex], [field]: parsed };
          });

          return recomputeChannel({ ...item, daily: updatedDaily });
        })
      );
    },
    [allDates]
  );

  const handleReset = () => {
    setApplyError(null);
    setApplySuccess(null);
    if (baselineData.length) {
      setTableData(cloneEditableChannels(baselineData));
    }
  };

  const handleApply = async () => {
    if (!sessionId || !hasPendingChanges) {
      return;
    }

    setIsApplying(true);
    setApplyError(null);
    setApplySuccess(null);

    try {
      const response = await applyPsiEdits(sessionId, pendingEdits);
      setBaselineData(cloneEditableChannels(tableData));
      setApplySuccess(
        `Applied ${response.applied} change${response.applied === 1 ? "" : "s"}. Logged ${response.log_entries} entr${
          response.log_entries === 1 ? "y" : "ies"
        }.`
      );
      await psiQuery.refetch();
      setLastAppliedAt(new Date().toISOString());
    } catch (error) {
      setApplyError(getErrorMessage(error, "Failed to apply edits."));
    } finally {
      setIsApplying(false);
    }
  };

  const handleDescriptionSave = async () => {
    if (!sessionId || !isDescriptionDirty) {
      return;
    }

    setIsSavingDescription(true);
    setDescriptionError(null);
    setDescriptionSaved(false);

    try {
      const { data } = await api.put<Session>(`/sessions/${sessionId}`, {
        description: descriptionDraft || null,
      });
      setDescriptionDraft(data.description ?? "");
      setOriginalDescription(data.description ?? "");
      setDescriptionSaved(true);
      queryClient.setQueryData<Session[]>(["sessions"], (current) =>
        current?.map((session) => (session.id === data.id ? data : session)) ?? current
      );
    } catch (error) {
      setDescriptionError(getErrorMessage(error, "Failed to update description."));
    } finally {
      setIsSavingDescription(false);
    }
  };

  return (
    <div className="page">
      <header>
        <h1>PSI Daily Table</h1>
        <p>Review the computed PSI metrics for the selected session.</p>
      </header>

      <section className={`psi-controls${controlsCollapsed ? " collapsed" : ""}`}>
        <div className="psi-controls-header">
          <h2>Filters &amp; Description</h2>
          <button type="button" className="collapse-toggle" onClick={() => setControlsCollapsed((previous) => !previous)}>
            {controlsCollapsed ? "詳細を表示" : "詳細を折りたたむ"}
          </button>
        </div>
        {!controlsCollapsed && (
          <div className="psi-controls-body">
            <div className="psi-panel psi-filter-panel">
              <h3>フィルタ</h3>
              <div className="psi-filter-grid">
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
                  <input
                    type="text"
                    value={skuCode}
                    onChange={(event) => setSkuCode(event.target.value)}
                    placeholder="Optional"
                  />
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
                  <input
                    type="text"
                    value={channel}
                    onChange={(event) => setChannel(event.target.value)}
                    placeholder="Optional"
                  />
                </label>
              </div>
              {sessionsQuery.isLoading && <p>Loading sessions...</p>}
              {sessionsQuery.isError && (
                <p className="error">{getErrorMessage(sessionsQuery.error, "Unable to load sessions.")}</p>
              )}
            </div>
            <div className="psi-panel psi-description-panel">
              {sessionId ? (
                <>
                  <div className="psi-description-dates">
                    <div>
                      <strong>開始日</strong>
                      <span>{sessionSummaryQuery.isLoading ? "…" : formattedStart}</span>
                    </div>
                    <div>
                      <strong>終了日</strong>
                      <span>{sessionSummaryQuery.isLoading ? "…" : formattedEnd}</span>
                    </div>
                  </div>
                  {sessionSummaryQuery.isError && (
                    <p className="error">{getErrorMessage(sessionSummaryQuery.error, "Unable to load session date range.")}</p>
                  )}
                  <label>
                    Description
                    <textarea
                      value={descriptionDraft}
                      onChange={(event) => {
                        setDescriptionDraft(event.target.value);
                        setDescriptionSaved(false);
                        setDescriptionError(null);
                      }}
                      placeholder="Add a description for this session"
                    />
                  </label>
                  <div className="session-summary-actions">
                    <button type="button" onClick={handleDescriptionSave} disabled={!isDescriptionDirty || isSavingDescription}>
                      {isSavingDescription ? "Saving..." : "Save Description"}
                    </button>
                    {descriptionError && <span className="error">{descriptionError}</span>}
                    {descriptionSaved && <span className="success">Description updated.</span>}
                  </div>
                  <div className="psi-session-meta">
                    <div>
                      <strong>作成日</strong>
                      <span>{formattedCreatedAt}</span>
                    </div>
                    <div>
                      <strong>更新日</strong>
                      <span>{formattedUpdatedAt}</span>
                    </div>
                  </div>
                </>
              ) : (
                <p>Select a session to view its details.</p>
              )}
            </div>
          </div>
        )}
      </section>

      <section>
        <div className="actions">
          <button type="button" onClick={() => psiQuery.refetch()} disabled={!sessionId || psiQuery.isFetching}>
            Refresh
          </button>
          <button type="button" onClick={handleReset} disabled={!baselineData.length}>
            Reset Table
          </button>
        </div>

        {psiQuery.isLoading && sessionId && <p>Loading PSI data...</p>}
        {psiQuery.isError && <p className="error">{getErrorMessage(psiQuery.error, "Unable to load PSI data.")}</p>}
        {tableData.length > 0 ? (
          <div className="psi-table-wrapper">
            <div className="psi-table-toolbar">
              <button
                type="button"
                className="secondary"
                onClick={handleDownload}
                disabled={!tableData.length || !visibleMetrics.length}
              >
                Download CSV
              </button>
              <button
                type="button"
                onClick={handleApply}
                disabled={!sessionId || !hasPendingChanges || isApplying}
              >
                {isApplying ? "Applying..." : "Apply"}
              </button>
            </div>
            {(applyError || applySuccess) && (
              <div className="psi-table-messages">
                {applyError && <span className="error">{applyError}</span>}
                {applySuccess && <span className="success">{applySuccess}</span>}
              </div>
            )}
            <div className="psi-table-container">
              <table className="psi-table">
                <thead>
                  <tr>
                    <th className="sticky-col col-sku">sku_code</th>
                    <th className="sticky-col col-sku-name">sku_name</th>
                    <th className="sticky-col col-warehouse">warehouse_name</th>
                    <th className="sticky-col col-channel">channel</th>
                    <th className="sticky-col col-div">
                      <div className="metric-header" ref={metricSelectorRef}>
                        <button
                          type="button"
                          className="metric-toggle"
                          onClick={() => setIsMetricSelectorOpen((previous) => !previous)}
                          aria-expanded={isMetricSelectorOpen}
                        >
                          div
                        </button>
                        {isMetricSelectorOpen && (
                          <div className="metric-selector">
                            <p className="metric-selector-title">表示する指標</p>
                            <div className="metric-selector-options">
                              {metricDefinitions.map((metric) => {
                                const key = metric.key as MetricKey;
                                const checked = visibleMetricKeys.includes(key);
                                const disabled = checked && visibleMetricKeys.length === 1;
                                return (
                                  <label key={metric.key}>
                                    <input
                                      type="checkbox"
                                      checked={checked}
                                      disabled={disabled}
                                      onChange={() => toggleMetricVisibility(key)}
                                    />
                                    {metric.label}
                                  </label>
                                );
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    </th>
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
                    const rowSpan = Math.max(visibleMetrics.length, 1);
                    const dateMap = new Map(item.daily.map((entry) => [entry.date, entry]));

                    if (!visibleMetrics.length) {
                      return null;
                    }

                    return visibleMetrics.map((metric, metricIndex) => (
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
                            const baselineEntry = baselineMap.get(makeCellKey(channelKey, date));
                            const baselineValue = baselineEntry ? baselineEntry[metric.key] ?? null : null;
                            const currentValue = value ?? null;
                            const isEdited = !valuesEqual(currentValue, baselineValue);

                            return (
                              <td key={cellKey} className="numeric">
                                <input
                                  type="text"
                                  className={`psi-edit-input${isEdited ? " edited" : ""}`}
                                  value={currentValue ?? ""}
                                  onChange={(event) =>
                                    handleEditableChange(channelKey, date, metric.key, event.target.value)
                                  }
                                  inputMode="decimal"
                                  onPaste={(event) => {
                                    event.preventDefault();
                                    handlePasteValues(channelKey, date, metric.key, event.clipboardData.getData("text"));
                                  }}
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
          </div>
        ) : (
          sessionId && !psiQuery.isLoading && <p>No PSI data for the current filters.</p>
        )}
      </section>
    </div>
  );
}
