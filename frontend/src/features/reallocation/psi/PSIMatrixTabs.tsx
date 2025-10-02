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
  { value: "cross2", label: "Cross Table_2" },
  { value: "heatmap", label: "Heatmap" },
  { value: "bars", label: "Bars" },
  { value: "kpis", label: "KPIs" },
] as const;

type TabValue = (typeof TAB_CONFIG)[number]["value"];

type SkuMetadata = {
  name?: string;
  category_1?: string | null;
  category_2?: string | null;
  category_3?: string | null;
};

const normalizeCategoryValue = (value?: string | null) => {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
};

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

  const [activeTab, setActiveTab] = useState<TabValue>("cross");
  const [skuIndex, setSkuIndex] = useState(() => {
    if (!normalizedSkuList.length) {
      return 0;
    }
    const nextIndex = initialSkuIndex ?? 0;
    return Math.min(Math.max(nextIndex, 0), normalizedSkuList.length - 1);
  });
  const [skuSearch, setSkuSearch] = useState("");

  const skuMetadataMap = useMemo(() => {
    const map = new Map<string, SkuMetadata>();
    data.forEach((row) => {
      const skuCode = String(row.sku);
      const existing = map.get(skuCode);
      const category1 = normalizeCategoryValue(row.category_1);
      const category2 = normalizeCategoryValue(row.category_2);
      const category3 = normalizeCategoryValue(row.category_3);
      if (existing) {
        if (!existing.name && row.skuName) {
          existing.name = row.skuName;
        }
        if ((existing.category_1 === undefined || existing.category_1 === null) && category1) {
          existing.category_1 = category1;
        }
        if ((existing.category_2 === undefined || existing.category_2 === null) && category2) {
          existing.category_2 = category2;
        }
        if ((existing.category_3 === undefined || existing.category_3 === null) && category3) {
          existing.category_3 = category3;
        }
      } else {
        map.set(skuCode, {
          name: row.skuName,
          category_1: category1,
          category_2: category2,
          category_3: category3,
        });
      }
    });
    return map;
  }, [data]);

  const normalizedSkuSearch = skuSearch.trim().toLowerCase();

  const filteredSkuList = useMemo(() => {
    if (!normalizedSkuSearch) {
      return normalizedSkuList;
    }
    return normalizedSkuList.filter((skuCode) => {
      const metadata = skuMetadataMap.get(skuCode);
      const name = metadata?.name?.toLowerCase() ?? "";
      return skuCode.toLowerCase().includes(normalizedSkuSearch) || name.includes(normalizedSkuSearch);
    });
  }, [normalizedSkuList, normalizedSkuSearch, skuMetadataMap]);

  useEffect(() => {
    if (typeof initialSkuIndex !== "number") {
      return;
    }
    setSkuIndex((prev) => {
      if (!filteredSkuList.length) {
        return 0;
      }
      const next = Math.min(Math.max(initialSkuIndex, 0), filteredSkuList.length - 1);
      return next === prev ? prev : next;
    });
  }, [filteredSkuList.length, initialSkuIndex]);

  useEffect(() => {
    setSkuIndex((prev) => {
      if (!filteredSkuList.length) {
        return 0;
      }
      const clamped = Math.min(Math.max(prev, 0), filteredSkuList.length - 1);
      return clamped === prev ? prev : clamped;
    });
  }, [filteredSkuList]);

  useEffect(() => {
    if (normalizedSkuSearch) {
      setSkuIndex(0);
    }
  }, [normalizedSkuSearch]);

  useEffect(() => {
    if (onSkuChange) {
      const currentSkuCode =
        filteredSkuList.length > 0
          ? filteredSkuList[Math.min(Math.max(skuIndex, 0), filteredSkuList.length - 1)]
          : null;
      const originalIndex = currentSkuCode ? normalizedSkuList.indexOf(currentSkuCode) : -1;
      onSkuChange(originalIndex);
    }
  }, [filteredSkuList, normalizedSkuList, onSkuChange, skuIndex]);

  const safeSkuIndex =
    filteredSkuList.length === 0 ? -1 : Math.min(Math.max(skuIndex, 0), filteredSkuList.length - 1);
  const currentSku = safeSkuIndex === -1 ? null : filteredSkuList[safeSkuIndex];

  const rowsForSku = useMemo(() => {
    if (!currentSku) {
      return [] as PsiRow[];
    }
    return data.filter((row) => String(row.sku) === currentSku);
  }, [currentSku, data]);

  const skuMetadata = currentSku ? skuMetadataMap.get(currentSku) : undefined;
  const skuName = skuMetadata?.name ?? rowsForSku[0]?.skuName ?? "";
  const skuNameDisplay = skuName || "—";
  const skuTitle = currentSku ? `${currentSku} – ${skuNameDisplay}` : "SKU未選択";
  const categoryLabel = [skuMetadata?.category_1, skuMetadata?.category_2, skuMetadata?.category_3]
    .map((value) => (value && value.trim() ? value : "—"))
    .join(" – ");
  const skuPositionLabel = safeSkuIndex === -1 ? "0 / 0" : `${safeSkuIndex + 1} / ${filteredSkuList.length}`;

  const hasRows = rowsForSku.length > 0;
  const emptyMessage =
    filteredSkuList.length === 0
      ? normalizedSkuSearch
        ? "No SKUs match the current search."
        : "No data available."
      : "No data for the selected SKU.";

  const handlePrevSku = () => {
    setSkuIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextSku = () => {
    setSkuIndex((prev) => {
      if (!filteredSkuList.length) {
        return 0;
      }
      return Math.min(filteredSkuList.length - 1, prev + 1);
    });
  };

  let tabContent: JSX.Element;
  if (!hasRows) {
    tabContent = <p className="psi-matrix-empty">{emptyMessage}</p>;
  } else {
    switch (activeTab) {
      case "origin":
        tabContent = <OriginView rows={rowsForSku} />;
        break;
      case "cross":
        tabContent = (
          <CrossTableView rows={rowsForSku} metrics={METRIC_DEFINITIONS} orientation="warehouse-first" />
        );
        break;
      case "cross2":
        tabContent = (
          <CrossTableView rows={rowsForSku} metrics={METRIC_DEFINITIONS} orientation="channel-first" />
        );
        break;
      case "heatmap":
        tabContent = <HeatmapView rows={rowsForSku} metrics={METRIC_DEFINITIONS} />;
        break;
      case "bars":
        tabContent = <BarsView rows={rowsForSku} />;
        break;
      case "kpis":
        tabContent = <KpiView rows={rowsForSku} />;
        break;
      default:
        tabContent = <OriginView rows={rowsForSku} />;
    }
  }

  return (
    <div className="psi-matrix-tabs">
      <div className="psi-matrix-toolbar">
        <div className="sku-navigation">
          <div className="sku-navigation-header">
            <div className="sku-navigation-title" role="status" aria-live="polite">
              {skuTitle}
            </div>
            <span className="sku-navigation-meta">{skuPositionLabel}</span>
          </div>
          <div className="sku-navigation-categories">{categoryLabel}</div>
          <div className="sku-navigation-actions">
            <button
              type="button"
              onClick={handlePrevSku}
              disabled={safeSkuIndex <= 0}
              aria-label="前のSKUを表示"
            >
              ‹ 前のSKU
            </button>
            <button
              type="button"
              onClick={handleNextSku}
              disabled={safeSkuIndex === -1 || safeSkuIndex >= filteredSkuList.length - 1}
              aria-label="次のSKUを表示"
            >
              次のSKU ›
            </button>
          </div>
          <label className="sku-navigation-search">
            <span>SKU検索</span>
            <input
              type="search"
              value={skuSearch}
              placeholder="SKUコード・名称を検索"
              onChange={(event) => setSkuSearch(event.target.value)}
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
      {hasRows && (
        <footer className="psi-matrix-footer">
          <span className="psi-matrix-count">
            Showing {rowsForSku.length} row{rowsForSku.length === 1 ? "" : "s"}. Total:{" "}
            {formatMetricValue(rowsForSku.reduce((total, row) => total + safeNumber(row.stockFinal), 0))} Final
          </span>
        </footer>
      )}
    </div>
  );
}
