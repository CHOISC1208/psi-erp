import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { api } from "../lib/api";
import { PSIChannel, PSIDailyEntry, PSIEditApplyResult, Session } from "../types";
import PSITableContent from "../components/PSITableContent";
import PSITableControls from "../components/PSITableControls";
import { useDailyPsiQuery, useSessionSummaryQuery, useSessionsQuery } from "../hooks/usePsiQueries";
import { EditableField, PSIEditableChannel, PSIEditableDay, PSIGridRow, metricDefinitions } from "./psiTableTypes";

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
  const [selectedSku, setSelectedSku] = useState<string | null>(null);
  const scrollToDateRef = useRef<(date: string) => void>(() => {});

  const sessionsQuery = useSessionsQuery();

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
    const params = new URLSearchParams(searchParams);
    if (value) {
      params.set("sessionId", value);
    } else {
      params.delete("sessionId");
    }
    setSearchParams(params);
  };

  const psiQuery = useDailyPsiQuery(sessionId, {
    sku_code: skuCode,
    warehouse_name: warehouseName,
    channel,
  });

  const sessionSummaryQuery = useSessionSummaryQuery(sessionId);

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
    if (!selectedSku) {
      return;
    }
    if (!tableData.some((item) => item.sku_code === selectedSku)) {
      setSelectedSku(null);
    }
  }, [selectedSku, tableData]);

  const displayedTableData = useMemo(
    () => (selectedSku ? tableData.filter((item) => item.sku_code === selectedSku) : []),
    [selectedSku, tableData]
  );

  const allDates = useMemo(() => {
    const dateSet = new Set<string>();
    displayedTableData.forEach((item) => {
      item.daily.forEach((entry) => {
        dateSet.add(entry.date);
      });
    });
    return Array.from(dateSet).sort(compareDateStrings);
  }, [displayedTableData]);

  const visibleMetrics = metricDefinitions;

  const todayIso = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, []);

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

  const registerScrollToDate = useCallback((handler: (date: string) => void) => {
    scrollToDateRef.current = handler;
    return () => {
      if (scrollToDateRef.current === handler) {
        scrollToDateRef.current = () => {};
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if ((event.key === "t" || event.key === "T") && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        scrollToDateRef.current(todayIso);
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);

    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [todayIso]);

  const handleDownload = () => {
    if (
      !displayedTableData.length ||
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

    const rows = displayedTableData.flatMap((item) => {
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

  const handleChannelCellClick = useCallback((row: PSIGridRow) => {
    console.debug("Channel cell clicked", row);
  }, []);

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

  const handleDescriptionChange = (value: string) => {
    setDescriptionDraft(value);
    setDescriptionSaved(false);
    setDescriptionError(null);
  };

  return (
    <div className="page psi-page">
      <header className="psi-page-header">
        <h1>PSI Daily Table</h1>
        <p>Review the computed PSI metrics for the selected session.</p>
      </header>

      <div className="psi-page-content">
        <PSITableControls
          isCollapsed={controlsCollapsed}
          onToggleCollapse={() => setControlsCollapsed((previous) => !previous)}
          sessionId={sessionId}
          availableSessions={availableSessions}
          onSessionChange={handleSessionChange}
          sessionsQuery={sessionsQuery}
          skuCode={skuCode}
          onSkuCodeChange={setSkuCode}
          warehouseName={warehouseName}
          onWarehouseNameChange={setWarehouseName}
          channel={channel}
          onChannelChange={setChannel}
          psiData={psiQuery.data}
          sessionSummaryQuery={sessionSummaryQuery}
          formattedStart={formattedStart}
          formattedEnd={formattedEnd}
          formattedCreatedAt={formattedCreatedAt}
          formattedUpdatedAt={formattedUpdatedAt}
          descriptionDraft={descriptionDraft}
          onDescriptionChange={handleDescriptionChange}
          onDescriptionSave={handleDescriptionSave}
          isDescriptionDirty={isDescriptionDirty}
          isSavingDescription={isSavingDescription}
          descriptionError={descriptionError}
          descriptionSaved={descriptionSaved}
          onApply={handleApply}
          canApply={Boolean(sessionId) && hasPendingChanges}
          isApplying={isApplying}
          onRefresh={() => psiQuery.refetch()}
          refreshDisabled={!sessionId || psiQuery.isFetching}
          onReset={handleReset}
          hasBaselineData={baselineData.length > 0}
          getErrorMessage={getErrorMessage}
          selectedSku={selectedSku}
          onSelectSku={setSelectedSku}
        />

        <PSITableContent
          sessionId={sessionId}
          isLoading={psiQuery.isLoading}
          isError={psiQuery.isError}
          errorMessage={psiQuery.isError ? getErrorMessage(psiQuery.error, "Unable to load PSI data.") : null}
          tableData={displayedTableData}
          hasAnyData={tableData.length > 0}
          selectedSku={selectedSku}
          visibleMetrics={visibleMetrics}
          allDates={allDates}
          todayIso={todayIso}
          formatDisplayDate={formatDisplayDate}
          onDownload={handleDownload}
          canDownload={Boolean(displayedTableData.length && visibleMetrics.length)}
          applyError={applyError}
          applySuccess={applySuccess}
          formatNumber={formatNumber}
          makeChannelKey={makeChannelKey}
          onEditableChange={handleEditableChange}
          onRegisterScrollToDate={registerScrollToDate}
          onChannelCellClick={handleChannelCellClick}
        />
      </div>
    </div>
  );
}
