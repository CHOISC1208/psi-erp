import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";

import api from "../lib/api";
import {
  ChannelTransfer,
  ChannelTransferCreate,
  PSIChannel,
  PSIDailyEntry,
  PSIEditApplyResult,
  PSIReportResponse,
  Session,
} from "../types";
import ChannelMoveModal from "../components/ChannelMoveModal";
import PSIReportModal from "../components/PSIReportModal";
import PSITableContent from "../components/PSITableContent";
import PSITableControls from "../components/PSITableControls";
import {
  useChannelTransfersQuery,
  useCreateChannelTransferMutation,
  useDailyPsiQuery,
  useDeleteChannelTransferMutation,
  usePsiReportMutation,
  useSessionSummaryQuery,
  useSessionsQuery,
} from "../hooks/usePsiQueries";
import {
  EditableField,
  MetricKey,
  PSIEditableChannel,
  PSIEditableDay,
  PSIGridMetricRow,
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

type ChannelMoveCellSelection = {
  channelKey: string;
  date: string;
  row: PSIGridMetricRow;
};

type ChannelMoveSaveChanges = {
  toCreate: ChannelTransferCreate[];
  toDelete: ChannelTransfer[];
};

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
    const channelMove = entry.channel_move ?? 0;
    const netFlow = inbound - outbound + channelMove;

    const anchorValue = effectiveAnchor ?? 0;
    const shouldKeepNull =
      effectiveAnchor === null && inbound === 0 && outbound === 0 && channelMove === 0;
    const stockClosing = shouldKeepNull ? null : anchorValue + netFlow;

    const safety = entry.safety_stock ?? 0;
    const movableStock = stockClosing === null ? null : stockClosing - safety;
    const inventoryDays =
      stockClosing === null || outbound <= 0 ? null : stockClosing / outbound;

    previousClosing = stockClosing;

    return {
      ...entry,
      stock_at_anchor: effectiveAnchor,
      net_flow: netFlow,
      stock_closing: stockClosing,
      movable_stock: movableStock,
      inventory_days: inventoryDays,
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

const applyPendingEditsToChannels = (
  channels: PSIEditableChannel[],
  edits: PSIEditUpdatePayload[]
): PSIEditableChannel[] => {
  if (!edits.length) {
    return channels;
  }

  const grouped = new Map<string, Map<string, PSIEditUpdatePayload>>();
  edits.forEach((edit) => {
    const channelKey = makeChannelKey(edit);
    const dateMap = grouped.get(channelKey);
    if (dateMap) {
      dateMap.set(edit.date, edit);
    } else {
      grouped.set(channelKey, new Map([[edit.date, edit]]));
    }
  });

  return channels.map((channel) => {
    const channelKey = makeChannelKey(channel);
    const channelEdits = grouped.get(channelKey);
    if (!channelEdits) {
      return channel;
    }

    const updatedDaily = channel.daily.map((entry) => {
      const edit = channelEdits.get(entry.date);
      if (!edit) {
        return { ...entry };
      }

      const nextEntry = { ...entry };
      if (Object.prototype.hasOwnProperty.call(edit, "inbound_qty")) {
        nextEntry.inbound_qty = edit.inbound_qty ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(edit, "outbound_qty")) {
        nextEntry.outbound_qty = edit.outbound_qty ?? null;
      }
      if (Object.prototype.hasOwnProperty.call(edit, "safety_stock")) {
        nextEntry.safety_stock = edit.safety_stock ?? null;
      }
      return nextEntry;
    });

    return recomputeChannel({ ...channel, daily: updatedDaily });
  });
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
  const pendingEditsRef = useRef<PSIEditUpdatePayload[]>([]);
  const [channelMoveSelection, setChannelMoveSelection] = useState<ChannelMoveCellSelection | null>(null);
  const [channelMoveError, setChannelMoveError] = useState<string | null>(null);
  const [isChannelMoveSaving, setIsChannelMoveSaving] = useState(false);
  const [visibleMetricKeys, setVisibleMetricKeys] = useState<MetricKey[]>(() =>
    metricDefinitions.map((metric) => metric.key)
  );
  const [skuOrder, setSkuOrder] = useState<string[]>([]);
  const [isReportModalOpen, setIsReportModalOpen] = useState(false);
  const [reportData, setReportData] = useState<PSIReportResponse | null>(null);
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportSku, setReportSku] = useState<string | null>(null);

  const sessionsQuery = useSessionsQuery();
  const channelTransfersQuery = useChannelTransfersQuery(sessionId);
  const createChannelTransferMutation = useCreateChannelTransferMutation();
  const deleteChannelTransferMutation = useDeleteChannelTransferMutation();
  const psiReportMutation = usePsiReportMutation();

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
      const baselineClone = cloneEditableChannels(prepared);
      const tableClone = cloneEditableChannels(prepared);
      const editsToReapply = pendingEditsRef.current;
      const tableWithEdits =
        editsToReapply.length > 0
          ? applyPendingEditsToChannels(tableClone, editsToReapply)
          : tableClone;
      setBaselineData(baselineClone);
      setTableData(tableWithEdits);
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
    setChannelMoveSelection(null);
    setChannelMoveError(null);
  }, [sessionId]);

  useEffect(() => {
    if (!selectedSku) {
      return;
    }
    if (!tableData.some((item) => item.sku_code === selectedSku)) {
      setSelectedSku(null);
    }
  }, [selectedSku, tableData]);

  useEffect(() => {
    if (!selectedSku) {
      setIsReportModalOpen(false);
      setReportData(null);
      setReportError(null);
      setReportSku(null);
      psiReportMutation.reset();
      return;
    }

    if (reportSku && reportSku !== selectedSku) {
      setIsReportModalOpen(false);
      setReportData(null);
      setReportError(null);
      setReportSku(null);
      psiReportMutation.reset();
    }
  }, [selectedSku, reportSku, psiReportMutation]);

  const displayedTableData = useMemo(
    () => (selectedSku ? tableData.filter((item) => item.sku_code === selectedSku) : []),
    [selectedSku, tableData]
  );

  const visibleMetrics = useMemo(
    () => metricDefinitions.filter((metric) => visibleMetricKeys.includes(metric.key)),
    [visibleMetricKeys]
  );

  const handleVisibleMetricKeysChange = useCallback((nextKeys: MetricKey[]) => {
    const orderedKeys = metricDefinitions
      .map((metric) => metric.key)
      .filter((key) => nextKeys.includes(key));
    setVisibleMetricKeys(orderedKeys);
  }, []);

  const handleSkuListChange = useCallback((nextSkuOrder: string[]) => {
    setSkuOrder(nextSkuOrder);
  }, []);

  const openReportModal = useCallback(
    async (forceRefresh: boolean) => {
      if (!sessionId || !selectedSku) {
        return;
      }

      setIsReportModalOpen(true);
      setReportError(null);

      if (!forceRefresh && reportData && reportSku === selectedSku && !psiReportMutation.isPending) {
        return;
      }

      setReportData(null);
      setReportSku(selectedSku);
      psiReportMutation.reset();

      try {
        const data = await psiReportMutation.mutateAsync({ sessionId, skuCode: selectedSku });
        setReportData(data);
      } catch (error) {
        setReportError(getErrorMessage(error, "レポートの生成に失敗しました。"));
      }
    },
    [
      sessionId,
      selectedSku,
      reportData,
      reportSku,
      psiReportMutation,
      getErrorMessage,
    ]
  );

  const handleGenerateReport = useCallback(() => {
    void openReportModal(false);
  }, [openReportModal]);

  const handleRetryReport = useCallback(() => {
    void openReportModal(true);
  }, [openReportModal]);

  const handleReportModalClose = useCallback(() => {
    setIsReportModalOpen(false);
  }, []);

  useEffect(() => {
    if (!selectedSku && skuOrder.length > 0) {
      setSelectedSku(skuOrder[0]);
      return;
    }
    if (selectedSku && skuOrder.length > 0 && !skuOrder.includes(selectedSku)) {
      setSelectedSku(skuOrder[0]);
    }
    if (selectedSku && skuOrder.length === 0) {
      setSelectedSku(null);
    }
  }, [selectedSku, skuOrder]);

  const selectedSkuIndex = selectedSku ? skuOrder.indexOf(selectedSku) : -1;
  const canGoToPreviousSku = selectedSkuIndex > 0;
  const canGoToNextSku = selectedSkuIndex >= 0 && selectedSkuIndex < skuOrder.length - 1;

  const handleGoToPreviousSku = useCallback(() => {
    if (!selectedSku) {
      return;
    }
    const index = skuOrder.indexOf(selectedSku);
    if (index > 0) {
      setSelectedSku(skuOrder[index - 1]);
    }
  }, [selectedSku, skuOrder]);

  const handleGoToNextSku = useCallback(() => {
    if (!selectedSku) {
      return;
    }
    const index = skuOrder.indexOf(selectedSku);
    if (index >= 0 && index < skuOrder.length - 1) {
      setSelectedSku(skuOrder[index + 1]);
    }
  }, [selectedSku, skuOrder]);

  const channelMap = useMemo(() => {
    const map = new Map<string, PSIEditableChannel>();
    tableData.forEach((item) => {
      map.set(makeChannelKey(item), item);
    });
    return map;
  }, [tableData]);

  useEffect(() => {
    if (channelMoveSelection && !channelMap.has(channelMoveSelection.channelKey)) {
      setChannelMoveSelection(null);
    }
  }, [channelMap, channelMoveSelection]);

  const channelTransfers = channelTransfersQuery.data ?? [];

  const selectedChannelForMove = useMemo(() => {
    if (!channelMoveSelection) {
      return null;
    }
    return channelMap.get(channelMoveSelection.channelKey) ?? null;
  }, [channelMap, channelMoveSelection]);

  const selectedChannelTransfers = useMemo(() => {
    if (!channelMoveSelection) {
      return [];
    }

    const { row, date } = channelMoveSelection;

    return channelTransfers.filter(
      (transfer) =>
        transfer.session_id === sessionId &&
        transfer.sku_code === row.sku_code &&
        transfer.warehouse_name === row.warehouse_name &&
        transfer.transfer_date === date &&
        (transfer.from_channel === row.channel || transfer.to_channel === row.channel)
    );
  }, [channelMoveSelection, channelTransfers, sessionId]);

  const currentNetMove = useMemo(() => {
    if (!channelMoveSelection) {
      return 0;
    }
    const channelName = channelMoveSelection.row.channel;
    return selectedChannelTransfers.reduce((total, transfer) => {
      if (transfer.to_channel === channelName) {
        return total + transfer.qty;
      }
      if (transfer.from_channel === channelName) {
        return total - transfer.qty;
      }
      return total;
    }, 0);
  }, [channelMoveSelection, selectedChannelTransfers]);

  const currentChannelMoveValue = useMemo(() => {
    if (!channelMoveSelection || !selectedChannelForMove) {
      return null;
    }
    const entry = selectedChannelForMove.daily.find((item) => item.date === channelMoveSelection.date);
    return entry?.channel_move ?? null;
  }, [channelMoveSelection, selectedChannelForMove]);

  const availableTransferChannels = useMemo(() => {
    if (!channelMoveSelection) {
      return [];
    }

    const { row } = channelMoveSelection;
    const unique = new Set<string>();
    tableData.forEach((item) => {
      if (item.sku_code === row.sku_code && item.warehouse_name === row.warehouse_name) {
        unique.add(item.channel);
      }
    });
    unique.delete(row.channel);
    return Array.from(unique).sort((a, b) => a.localeCompare(b));
  }, [channelMoveSelection, tableData]);

  const inventorySnapshot = useMemo(() => {
    if (!channelMoveSelection) {
      return [];
    }

    const { row, date } = channelMoveSelection;

    return tableData
      .filter((item) => item.sku_code === row.sku_code && item.warehouse_name === row.warehouse_name)
      .map((item) => {
        const entry = item.daily.find((daily) => daily.date === date);
        return {
          channel: item.channel,
          stockClosing: entry?.stock_closing ?? null,
        };
      });
  }, [channelMoveSelection, tableData]);

  const channelMoveModalContext = useMemo(() => {
    if (!channelMoveSelection || !selectedChannelForMove) {
      return null;
    }
    return { selection: channelMoveSelection, channel: selectedChannelForMove };
  }, [channelMoveSelection, selectedChannelForMove]);

  const channelTransfersLoading = channelTransfersQuery.isLoading;
  const channelTransfersRefetching = channelTransfersQuery.isFetching;

  const selectedChannelInfo = useMemo(() => {
    if (!channelMoveModalContext) {
      return null;
    }
    const { channel } = channelMoveModalContext;
    return {
      sku_code: channel.sku_code,
      sku_name: channel.sku_name ?? null,
      warehouse_name: channel.warehouse_name,
      channel: channel.channel,
    };
  }, [channelMoveModalContext]);

  const allDates = useMemo(() => {
    const dateSet = new Set<string>();
    displayedTableData.forEach((item) => {
      item.daily.forEach((entry) => {
        dateSet.add(entry.date);
      });
    });
    return Array.from(dateSet).sort(compareDateStrings);
  }, [displayedTableData]);

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

  useEffect(() => {
    pendingEditsRef.current = pendingEdits;
  }, [pendingEdits]);

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
      "category_1",
      "category_2",
      "category_3",
      "fw_rank",
      "ss_rank",
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
          item.category_1 ?? "",
          item.category_2 ?? "",
          item.category_3 ?? "",
          item.fw_rank ?? "",
          item.ss_rank ?? "",
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

  const handleChannelCellClick = useCallback((selection: ChannelMoveCellSelection) => {
    setChannelMoveError(null);
    setChannelMoveSelection(selection);
  }, []);

  const handleChannelMoveSave = useCallback(
    async (changes: ChannelMoveSaveChanges) => {
      if (!sessionId || !channelMoveSelection) {
        return;
      }

      if (!changes.toCreate.length && !changes.toDelete.length) {
        setChannelMoveError(null);
        return;
      }

      setIsChannelMoveSaving(true);
      setChannelMoveError(null);

      try {
        for (const transfer of changes.toDelete) {
          await deleteChannelTransferMutation.mutateAsync(transfer);
        }

        for (const transfer of changes.toCreate) {
          await createChannelTransferMutation.mutateAsync(transfer);
        }

        await channelTransfersQuery.refetch();
        await psiQuery.refetch();
        setChannelMoveError(null);
      } catch (error) {
        setChannelMoveError(getErrorMessage(error, "Failed to update channel moves."));
      } finally {
        setIsChannelMoveSaving(false);
      }
    },
    [
      channelMoveSelection,
      channelTransfersQuery,
      createChannelTransferMutation,
      deleteChannelTransferMutation,
      psiQuery,
      sessionId,
    ]
  );

  const handleChannelMoveClose = () => {
    setChannelMoveSelection(null);
    setChannelMoveError(null);
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
          onSkuListChange={handleSkuListChange}
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
          availableMetrics={metricDefinitions}
          selectedMetricKeys={visibleMetricKeys}
          onSelectedMetricKeysChange={handleVisibleMetricKeysChange}
          allDates={allDates}
          formatDisplayDate={formatDisplayDate}
          onDownload={handleDownload}
          canDownload={Boolean(displayedTableData.length && visibleMetrics.length)}
          onGenerateReport={handleGenerateReport}
          canGenerateReport={Boolean(sessionId && selectedSku)}
          isGeneratingReport={psiReportMutation.isPending}
          applyError={applyError}
          applySuccess={applySuccess}
          formatNumber={formatNumber}
          makeChannelKey={makeChannelKey}
          onEditableChange={handleEditableChange}
          onRegisterScrollToDate={registerScrollToDate}
          onChannelCellClick={handleChannelCellClick}
          onGoToPreviousSku={canGoToPreviousSku ? handleGoToPreviousSku : undefined}
          onGoToNextSku={canGoToNextSku ? handleGoToNextSku : undefined}
          activeSkuCode={selectedSku}
          activeSkuName={displayedTableData[0]?.sku_name ?? null}
        />

        <ChannelMoveModal
          isOpen={Boolean(channelMoveModalContext)}
          sessionId={sessionId}
          date={channelMoveModalContext?.selection.date ?? null}
          channel={selectedChannelInfo}
          existingTransfers={selectedChannelTransfers}
          availableChannels={availableTransferChannels}
          isLoading={channelTransfersLoading && !channelTransfersQuery.data}
          isRefetching={channelTransfersRefetching && Boolean(channelTransfersQuery.data)}
          isSaving={isChannelMoveSaving}
          error={channelMoveError}
          onClose={handleChannelMoveClose}
          onSave={handleChannelMoveSave}
          formatDisplayDate={formatDisplayDate}
          formatNumber={formatNumber}
          currentNetMove={currentNetMove}
          channelMoveValue={currentChannelMoveValue}
          inventorySnapshot={inventorySnapshot}
        />
        <PSIReportModal
          isOpen={isReportModalOpen}
          skuCode={selectedSku ?? reportData?.sku_code ?? null}
          skuName={displayedTableData[0]?.sku_name ?? reportData?.sku_name ?? null}
          report={reportData?.report_markdown ?? null}
          generatedAt={reportData?.generated_at ?? null}
          settings={reportData?.settings ?? null}
          isLoading={psiReportMutation.isPending}
          error={reportError}
          onClose={handleReportModalClose}
          onRetry={selectedSku ? handleRetryReport : undefined}
        />
      </div>
    </div>
  );
}
