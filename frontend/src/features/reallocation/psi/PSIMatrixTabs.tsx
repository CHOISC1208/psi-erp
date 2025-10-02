import { useEffect, useMemo, useState } from "react";

import OriginView from "./views/OriginView";
import CrossTableView from "./views/CrossTableView";
import HeatmapView from "./views/HeatmapView";
import BarsView from "./views/BarsView";
import KpiView from "./views/KpiView";
import type { PsiRow } from "./types";
import { METRIC_DEFINITIONS, formatMetricValue, safeNumber } from "./utils";
import "../../../styles/psi-matrix.css";

const TAB_CONFIG = [
  { value: "origin", label: "Origin" },
  { value: "cross", label: "Cross Table" },
  { value: "heatmap", label: "Heatmap" },
  { value: "bars", label: "Bars" },
  { value: "kpis", label: "KPIs" },
] as const;

type TabValue = (typeof TAB_CONFIG)[number]["value"];

interface PSIMatrixTabsProps {
  data: PsiRow[];
  skuList: string[];
  initialSkuIndex?: number;
  onSkuChange?: (index: number) => void;
}

export function PSIMatrixTabs({ data, skuList, initialSkuIndex, onSkuChange }: PSIMatrixTabsProps) {
  const normalizedSkuList = useMemo(() => {
    if (skuList.length > 0) {
      return skuList;
    }
    const set = new Set<string>();
    const list: string[] = [];
    data.forEach((row) => {
      const sku = String(row.sku);
      if (!set.has(sku)) {
        set.add(sku);
        list.push(sku);
      }
    });
    return list;
  }, [data, skuList]);

  const [activeTab, setActiveTab] = useState<TabValue>("origin");
  const [skuIndex, setSkuIndex] = useState(() => {
    if (!normalizedSkuList.length) {
      return 0;
    }
    const nextIndex = initialSkuIndex ?? 0;
    return Math.min(Math.max(nextIndex, 0), normalizedSkuList.length - 1);
  });
  const [warehouseFilter, setWarehouseFilter] = useState("");
  const [channelFilter, setChannelFilter] = useState("");

  useEffect(() => {
    if (typeof initialSkuIndex !== "number") {
      return;
    }
    setSkuIndex((prev) => {
      if (!normalizedSkuList.length) {
        return 0;
      }
      const next = Math.min(Math.max(initialSkuIndex, 0), normalizedSkuList.length - 1);
      return next === prev ? prev : next;
    });
  }, [initialSkuIndex, normalizedSkuList.length]);

  useEffect(() => {
    setSkuIndex((prev) => {
      if (!normalizedSkuList.length) {
        return 0;
      }
      const clamped = Math.min(Math.max(prev, 0), normalizedSkuList.length - 1);
      return clamped === prev ? prev : clamped;
    });
  }, [normalizedSkuList]);

  useEffect(() => {
    if (onSkuChange) {
      onSkuChange(skuIndex);
    }
  }, [skuIndex, onSkuChange]);

  const currentSku = normalizedSkuList.length > 0 ? normalizedSkuList[Math.min(skuIndex, normalizedSkuList.length - 1)] : null;

  const rowsForSku = useMemo(() => {
    if (!currentSku) {
      return [] as PsiRow[];
    }
    return data.filter((row) => String(row.sku) === currentSku);
  }, [currentSku, data]);

  const normalizedWarehouseFilter = warehouseFilter.trim().toLowerCase();
  const normalizedChannelFilter = channelFilter.trim().toLowerCase();

  const filteredRows = useMemo(() => {
    if (!normalizedWarehouseFilter && !normalizedChannelFilter) {
      return rowsForSku;
    }
    return rowsForSku.filter((row) => {
      const warehouseMatch = normalizedWarehouseFilter
        ? row.warehouse.toLowerCase().includes(normalizedWarehouseFilter)
        : true;
      const channelMatch = normalizedChannelFilter
        ? row.channel.toLowerCase().includes(normalizedChannelFilter)
        : true;
      return warehouseMatch && channelMatch;
    });
  }, [rowsForSku, normalizedWarehouseFilter, normalizedChannelFilter]);

  const skuName = rowsForSku[0]?.skuName ?? "";
  const skuIndicator = currentSku
    ? `${skuIndex + 1} / ${normalizedSkuList.length} : ${currentSku}${skuName ? ` – ${skuName}` : ""}`
    : "-";

  const hasFilteredRows = filteredRows.length > 0;
  const emptyMessage = rowsForSku.length === 0 ? "No data for the selected SKU." : "No rows match the current filters.";

  const handlePrevSku = () => {
    setSkuIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextSku = () => {
    setSkuIndex((prev) => {
      if (!normalizedSkuList.length) {
        return 0;
      }
      return Math.min(normalizedSkuList.length - 1, prev + 1);
    });
  };

  let tabContent: JSX.Element;
  if (!hasFilteredRows) {
    tabContent = <p className="psi-matrix-empty">{emptyMessage}</p>;
  } else {
    switch (activeTab) {
      case "origin":
        tabContent = <OriginView rows={filteredRows} />;
        break;
      case "cross":
        tabContent = <CrossTableView rows={filteredRows} metrics={METRIC_DEFINITIONS} />;
        break;
      case "heatmap":
        tabContent = <HeatmapView rows={filteredRows} metrics={METRIC_DEFINITIONS} />;
        break;
      case "bars":
        tabContent = <BarsView rows={filteredRows} />;
        break;
      case "kpis":
        tabContent = <KpiView rows={filteredRows} />;
        break;
      default:
        tabContent = <OriginView rows={filteredRows} />;
    }
  }

  return (
    <div className="psi-matrix-tabs">
      <div className="psi-matrix-toolbar">
        <div className="sku-navigation">
          <button type="button" onClick={handlePrevSku} disabled={skuIndex <= 0}>
            前のSKU
          </button>
          <span className="sku-indicator">{skuIndicator}</span>
          <button
            type="button"
            onClick={handleNextSku}
            disabled={normalizedSkuList.length === 0 || skuIndex >= normalizedSkuList.length - 1}
          >
            次のSKU
          </button>
        </div>
        <div className="psi-matrix-filters">
          <label>
            Warehouse filter
            <input
              type="search"
              value={warehouseFilter}
              placeholder="Contains…"
              onChange={(event) => setWarehouseFilter(event.target.value)}
            />
          </label>
          <label>
            Channel filter
            <input
              type="search"
              value={channelFilter}
              placeholder="Contains…"
              onChange={(event) => setChannelFilter(event.target.value)}
            />
          </label>
        </div>
      </div>
      <div className="psi-matrix-tablist" role="tablist" aria-label="PSI matrix views">
        {TAB_CONFIG.map((tab) => (
          <button
            key={tab.value}
            type="button"
            role="tab"
            aria-selected={activeTab === tab.value}
            className={`psi-matrix-tab ${activeTab === tab.value ? "active" : ""}`}
            onClick={() => setActiveTab(tab.value)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="psi-matrix-content" role="tabpanel">
        {tabContent}
      </div>
      {hasFilteredRows && (
        <footer className="psi-matrix-footer">
          <span className="psi-matrix-count">
            Showing {filteredRows.length} row{filteredRows.length === 1 ? "" : "s"}. Total:{" "}
            {formatMetricValue(filteredRows.reduce((total, row) => total + safeNumber(row.stockFinal), 0))} Final
          </span>
        </footer>
      )}
    </div>
  );
}
