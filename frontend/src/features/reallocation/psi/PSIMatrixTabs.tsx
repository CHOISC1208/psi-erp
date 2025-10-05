import { useCallback, useEffect, useMemo, useState } from "react";

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

type SkuSuggestion = {
  code: string;
  label: string;
};

const MIN_SEARCH_LENGTH = 3;
const MAX_SUGGESTION_RESULTS = 8;
const MAX_RECENT_SKUS = 6;

const copySkuCode = async (code: string) => {
  if (!code || typeof navigator === "undefined" || !navigator.clipboard) {
    return;
  }
  try {
    await navigator.clipboard.writeText(code);
  } catch {
    // no-op: clipboard write may be blocked.
  }
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
  skuSearch?: string;
  onSkuSearchChange?: (value: string) => void;
}

export function PSIMatrixTabs({
  data,
  skuList,
  initialSkuIndex,
  onSkuChange,
  skuSearch,
  onSkuSearchChange,
}: PSIMatrixTabsProps) {
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
  const [internalSkuSearch, setInternalSkuSearch] = useState("");
  const [recentSkus, setRecentSkus] = useState<string[]>([]);
  const isSkuSearchControlled = typeof skuSearch === "string";
  const skuSearchValue = isSkuSearchControlled ? skuSearch : internalSkuSearch;
  const [isSuggestionsVisible, setSuggestionsVisible] = useState(false);

  const handleSkuSearchChange = (value: string) => {
    if (onSkuSearchChange) {
      onSkuSearchChange(value);
    }
    if (!isSkuSearchControlled) {
      setInternalSkuSearch(value);
    }
  };

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

  const normalizedSkuSearch = skuSearchValue.trim().toLowerCase();

  const searchableIndex = useMemo(() => {
    return normalizedSkuList.map((skuCode) => {
      const metadata = skuMetadataMap.get(skuCode);
      const categoryParts = [
        metadata?.category_1 ?? null,
        metadata?.category_2 ?? null,
        metadata?.category_3 ?? null,
      ].filter((value): value is string => Boolean(value && value.trim()));
      const categoryLabel = categoryParts.join(" / ");
      return {
        code: skuCode,
        name: metadata?.name ?? "",
        categories: categoryLabel,
      };
    });
  }, [normalizedSkuList, skuMetadataMap]);

  const filteredSkuList = useMemo(() => {
    if (!normalizedSkuSearch) {
      return normalizedSkuList;
    }
    return normalizedSkuList.filter((skuCode) => {
      const metadata = skuMetadataMap.get(skuCode);
      const name = metadata?.name?.toLowerCase() ?? "";
      const categoryValues = [
        metadata?.category_1?.toLowerCase() ?? "",
        metadata?.category_2?.toLowerCase() ?? "",
        metadata?.category_3?.toLowerCase() ?? "",
      ];
      return (
        skuCode.toLowerCase().includes(normalizedSkuSearch) ||
        name.includes(normalizedSkuSearch) ||
        categoryValues.some((value) => value.includes(normalizedSkuSearch))
      );
    });
  }, [normalizedSkuList, normalizedSkuSearch, skuMetadataMap]);

  const skuSuggestions = useMemo(() => {
    if (normalizedSkuSearch.length < MIN_SEARCH_LENGTH) {
      return [] as SkuSuggestion[];
    }
    const results: SkuSuggestion[] = [];
    for (const entry of searchableIndex) {
      const labelParts = [entry.code];
      if (entry.name) {
        labelParts.push(entry.name);
      }
      if (entry.categories) {
        labelParts.push(entry.categories);
      }
      const label = labelParts.join(" · ");
      if (label.toLowerCase().includes(normalizedSkuSearch)) {
        results.push({ code: entry.code, label });
      }
      if (results.length >= MAX_SUGGESTION_RESULTS) {
        break;
      }
    }
    return results;
  }, [normalizedSkuSearch, searchableIndex]);

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

  const setSkuIndexByCode = useCallback(
    (code: string) => {
      if (!code) {
        return;
      }
      const normalizedIndex = normalizedSkuList.indexOf(code);
      if (normalizedIndex === -1) {
        return;
      }
      setSkuIndex((prev) => {
        if (prev === normalizedIndex) {
          return prev;
        }
        return normalizedIndex;
      });
      handleSkuSearchChange("");
    },
    [handleSkuSearchChange, normalizedSkuList],
  );

  const handleSuggestionSelect = useCallback(
    (code: string) => {
      setSuggestionsVisible(false);
      setSkuIndexByCode(code);
    },
    [setSkuIndexByCode],
  );

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
  const categoryParts = [skuMetadata?.category_1, skuMetadata?.category_2, skuMetadata?.category_3].filter(
    (value): value is string => Boolean(value && value.trim()),
  );
  const categoryLabel = categoryParts.length > 0 ? categoryParts.join(" / ") : "—";
  const skuPositionLabel = safeSkuIndex === -1 ? "0 / 0" : `${safeSkuIndex + 1} / ${filteredSkuList.length}`;

  useEffect(() => {
    if (!currentSku) {
      return;
    }
    setRecentSkus((prev) => {
      const next = [currentSku, ...prev.filter((item) => item !== currentSku)];
      return next.slice(0, MAX_RECENT_SKUS);
    });
  }, [currentSku]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      const target = event.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable)) {
        return;
      }
      event.preventDefault();
      if (event.key === "ArrowLeft") {
        setSkuIndex((prev) => Math.max(0, prev - 1));
      } else {
        setSkuIndex((prev) => {
          if (!filteredSkuList.length) {
            return 0;
          }
          return Math.min(filteredSkuList.length - 1, prev + 1);
        });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [filteredSkuList.length]);

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
        <div className="sku-navigation" role="region" aria-label="SKU navigation">
          <div className="sku-navigation-card">
            <div className="sku-navigation-search-area">
              <label className="sku-navigation-search">
                <span>SKU検索</span>
                <input
                  type="search"
                  value={skuSearchValue}
                  placeholder="SKUコード・名称・カテゴリを検索"
                  onChange={(event) => handleSkuSearchChange(event.target.value)}
                  onFocus={() => setSuggestionsVisible(true)}
                  onBlur={() => {
                    // Delay hiding suggestions slightly to allow click handlers to run.
                    setTimeout(() => setSuggestionsVisible(false), 120);
                  }}
                  aria-label="SKUコード・名称・カテゴリを検索"
                />
              </label>
              {recentSkus.length > 0 && (
                <div className="sku-recent-pills" aria-label="最近検索したSKU">
                  {recentSkus.map((skuCode) => (
                    <button
                      key={skuCode}
                      type="button"
                      className="sku-recent-pill"
                      onClick={() => setSkuIndexByCode(skuCode)}
                      aria-label={`SKU ${skuCode} を表示`}
                    >
                      {skuCode}
                    </button>
                  ))}
                </div>
              )}
              {isSuggestionsVisible && skuSuggestions.length > 0 && (
                <div className="sku-search-suggestions" role="listbox">
                  {skuSuggestions.map((suggestion) => (
                    <button
                      type="button"
                      key={suggestion.code}
                      role="option"
                      className="sku-search-suggestion"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => handleSuggestionSelect(suggestion.code)}
                    >
                      <span className="suggestion-code">{suggestion.code}</span>
                      <span className="suggestion-label">{suggestion.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="sku-navigation-summary">
              <div className="sku-navigation-header">
                <div className="sku-navigation-title" role="status" aria-live="polite">
                  <span className="sku-code-badge" aria-label="SKUコード">
                    <code>{currentSku ?? "—"}</code>
                    {currentSku && (
                      <button
                        type="button"
                        className="sku-copy-button"
                        onClick={() => copySkuCode(currentSku)}
                        aria-label={`${currentSku} をコピー`}
                      >
                        📋
                      </button>
                    )}
                  </span>
                  <span className="sku-title-text">{skuNameDisplay}</span>
                </div>
                <span className="sku-navigation-meta">{skuPositionLabel}</span>
              </div>
              <div className="sku-navigation-categories">{categoryLabel}</div>
            </div>
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
          </div>
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
