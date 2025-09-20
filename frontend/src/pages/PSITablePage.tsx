import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, UIEvent as ReactUIEvent } from "react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import { api } from "../lib/api";
import { PSIChannel, PSIDailyEntry, PSIEditApplyResult, Session } from "../types";
import PSITableContent from "../components/PSITableContent";
import PSITableControls from "../components/PSITableControls";
import { useDailyPsiQuery, useSessionSummaryQuery, useSessionsQuery } from "../hooks/usePsiQueries";
import {
  EditableField,
  MetricDefinition,
  MetricKey,
  PSIEditableChannel,
  PSIEditableDay,
  isEditableMetric,
  metricDefinitions,
} from "./psiTableTypes";

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
  const [visibleMetricKeys, setVisibleMetricKeys] = useState<MetricKey[]>(() =>
    metricDefinitions.map((metric) => metric.key as MetricKey)
  );
  const [isMetricSelectorOpen, setIsMetricSelectorOpen] = useState(false);
  const metricSelectorRef = useRef<HTMLDivElement | null>(null);
  const [selectedChannelKey, setSelectedChannelKey] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement | null>(null);
  const tableScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const topScrollContainerRef = useRef<HTMLDivElement | null>(null);
  const [tableContentWidth, setTableContentWidth] = useState(0);
  const syncingScrollRef = useRef(false);
  const rowGroupRefs = useRef<(HTMLTableRowElement | null)[]>([]);
  const controlsRef = useRef<HTMLElement | null>(null);
  const tableScrollAreaRef = useRef<HTMLDivElement | null>(null);

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
    setIsMetricSelectorOpen(false);
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

  useLayoutEffect(() => {
    const scrollAreaElement = tableScrollAreaRef.current;
    if (!scrollAreaElement) {
      return;
    }

    const updateHeaderOffset = () => {
      const controlsElement = controlsRef.current;
      const controlsHeight = controlsElement?.getBoundingClientRect().height ?? 0;
      scrollAreaElement.style.setProperty("--psi-table-header-offset", `${controlsHeight}px`);
    };

    updateHeaderOffset();

    const resizeObservers: ResizeObserver[] = [];

    if (typeof ResizeObserver !== "undefined") {
      const controlsElement = controlsRef.current;
      if (controlsElement) {
        const observer = new ResizeObserver(() => {
          updateHeaderOffset();
        });
        observer.observe(controlsElement);
        resizeObservers.push(observer);
      }
    }

    const handleWindowResize = () => {
      updateHeaderOffset();
    };

    window.addEventListener("resize", handleWindowResize);

    return () => {
      resizeObservers.forEach((observer) => observer.disconnect());
      window.removeEventListener("resize", handleWindowResize);
      scrollAreaElement.style.removeProperty("--psi-table-header-offset");
    };
  }, [controlsCollapsed, tableData.length]);

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

  const channelKeyOrder = useMemo(() => tableData.map((item) => makeChannelKey(item)), [tableData]);

  useEffect(() => {
    rowGroupRefs.current = new Array(channelKeyOrder.length).fill(null);
  }, [channelKeyOrder.length]);

  const todayIso = useMemo(() => {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }, []);

  useEffect(() => {
    if (!selectedChannelKey) {
      return;
    }
    if (!tableData.some((item) => makeChannelKey(item) === selectedChannelKey)) {
      setSelectedChannelKey(null);
    }
  }, [selectedChannelKey, tableData]);

  useEffect(() => {
    const table = tableRef.current;
    if (!table) {
      setTableContentWidth(0);
      return;
    }

    const updateWidth = () => {
      const containerWidth = tableScrollContainerRef.current?.clientWidth ?? 0;
      setTableContentWidth(Math.max(table.scrollWidth, containerWidth));
    };

    updateWidth();

    const resizeObserver = new ResizeObserver(updateWidth);
    resizeObserver.observe(table);
    if (tableScrollContainerRef.current) {
      resizeObserver.observe(tableScrollContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [tableData, visibleMetrics, allDates]);

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

  const handleClearSelection = useCallback(() => {
    setSelectedChannelKey(null);
  }, []);

  const handleTopScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      const bottom = tableScrollContainerRef.current;
      if (!bottom) {
        return;
      }
      if (syncingScrollRef.current) {
        return;
      }
      syncingScrollRef.current = true;
      bottom.scrollLeft = event.currentTarget.scrollLeft;
      window.requestAnimationFrame(() => {
        syncingScrollRef.current = false;
      });
    },
    []
  );

  const handleBottomScroll = useCallback(
    (event: ReactUIEvent<HTMLDivElement>) => {
      const top = topScrollContainerRef.current;
      if (!top) {
        return;
      }
      if (syncingScrollRef.current) {
        return;
      }
      syncingScrollRef.current = true;
      top.scrollLeft = event.currentTarget.scrollLeft;
      window.requestAnimationFrame(() => {
        syncingScrollRef.current = false;
      });
    },
    []
  );

  const scrollToDate = useCallback(
    (targetDate: string) => {
      const container = tableScrollContainerRef.current;
      const table = tableRef.current;
      if (!container || !table) {
        return;
      }

      const headerCell = table.querySelector<HTMLTableCellElement>(`th[data-date="${targetDate}"]`);
      if (!headerCell) {
        return;
      }

      const containerRect = container.getBoundingClientRect();
      const cellRect = headerCell.getBoundingClientRect();
      const offset = cellRect.left - containerRect.left;
      const center = offset - container.clientWidth / 2 + headerCell.clientWidth / 2;
      const nextScrollLeft = Math.max(0, center);

      const top = topScrollContainerRef.current;
      syncingScrollRef.current = true;
      container.scrollTo({ left: nextScrollLeft, behavior: "smooth" });
      if (top) {
        top.scrollTo({ left: nextScrollLeft, behavior: "smooth" });
      }
      window.requestAnimationFrame(() => {
        syncingScrollRef.current = false;
      });
    },
    []
  );

  const handleTodayClick = useCallback(() => {
    scrollToDate(todayIso);
  }, [scrollToDate, todayIso]);

  const handleRowSelection = useCallback((channelKey: string) => {
    setSelectedChannelKey(channelKey);
  }, []);

  const handleRowKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTableRowElement>, index: number, channelKey: string) => {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        const next = rowGroupRefs.current[index + 1];
        next?.focus();
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        const previous = rowGroupRefs.current[index - 1];
        previous?.focus();
        return;
      }
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        setSelectedChannelKey(channelKey);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSelectedChannelKey(null);
      }
    },
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleGlobalKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setSelectedChannelKey(null);
        return;
      }
      if ((event.key === "t" || event.key === "T") && !event.altKey && !event.ctrlKey && !event.metaKey) {
        event.preventDefault();
        scrollToDate(todayIso);
      }
    };

    window.addEventListener("keydown", handleGlobalKeyDown);

    return () => {
      window.removeEventListener("keydown", handleGlobalKeyDown);
    };
  }, [scrollToDate, todayIso]);

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
    setSelectedChannelKey(null);
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
          ref={controlsRef}
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
          onTodayClick={handleTodayClick}
          hasBaselineData={baselineData.length > 0}
          getErrorMessage={getErrorMessage}
        />

        <PSITableContent
          sessionId={sessionId}
          isLoading={psiQuery.isLoading}
          isError={psiQuery.isError}
          errorMessage={psiQuery.isError ? getErrorMessage(psiQuery.error, "Unable to load PSI data.") : null}
          tableData={tableData}
          visibleMetrics={visibleMetrics}
          metricDefinitions={metricDefinitions}
          visibleMetricKeys={visibleMetricKeys}
          isMetricSelectorOpen={isMetricSelectorOpen}
          onMetricSelectorToggle={() => setIsMetricSelectorOpen((previous) => !previous)}
          onMetricVisibilityChange={toggleMetricVisibility}
          metricSelectorRef={metricSelectorRef}
          allDates={allDates}
          todayIso={todayIso}
          formatDisplayDate={formatDisplayDate}
          tableContentWidth={tableContentWidth}
          tableRef={tableRef}
          tableScrollContainerRef={tableScrollContainerRef}
          topScrollContainerRef={topScrollContainerRef}
          tableScrollAreaRef={tableScrollAreaRef}
          onTopScroll={handleTopScroll}
          onBottomScroll={handleBottomScroll}
          onDownload={handleDownload}
          canDownload={Boolean(tableData.length && visibleMetrics.length)}
          selectedChannelKey={selectedChannelKey}
          onClearSelection={handleClearSelection}
          applyError={applyError}
          applySuccess={applySuccess}
          baselineMap={baselineMap}
          onEditableChange={handleEditableChange}
          onPasteValues={handlePasteValues}
          formatNumber={formatNumber}
          isEditableMetric={isEditableMetric}
          makeChannelKey={makeChannelKey}
          makeCellKey={makeCellKey}
          valuesEqual={valuesEqual}
          onRowSelection={handleRowSelection}
          rowGroupRefs={rowGroupRefs}
          onRowKeyDown={handleRowKeyDown}
        />
      </div>
    </div>
  );
}
