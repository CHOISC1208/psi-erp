import { useCallback, useEffect, useMemo, useState } from "react";

import {
  buildColumnGroups,
  formatMetricValue,
  makeColumnKey,
  METRIC_DEFINITIONS,
  safeNumber,
} from "../features/reallocation/psi/utils";
import type { MetricDefinition, MetricKey, PsiRow } from "../features/reallocation/psi/types";
import {
  useTestAlgoMetadata,
  useTestAlgoRunMutation,
} from "../hooks/useTestAlgo";
import type {
  MatrixRow,
  RecommendedMoveSuggestion,
  TestAlgoMetadata,
  TestAlgoRunRequest,
  TestAlgoRowInput,
} from "../types";

const EDITABLE_METRICS: MetricKey[] = [
  "stockStart",
  "inbound",
  "outbound",
  "stockClosing",
  "stdStock",
];

interface EditablePsiRow extends PsiRow {
  gapAfter: number;
  move: number;
  stockFinal: number;
}

interface SelectedCell {
  sku: string;
  metric: MetricKey;
  columnKey: string;
}

interface DisplayColumn {
  key: string;
  warehouse: string;
  channel: string;
}

const DEFAULT_SKU_COUNT = 3;

const roundTo = (value: number, digits = 2) => {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
};

const createSeedFromString = (value: string) => {
  if (!value) {
    return Date.now() >>> 0;
  }
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return Math.abs(hash) >>> 0;
};

const mulberry32 = (seed: number) => {
  let t = seed + 0x6d2b79f5;
  return () => {
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const randomMetric = (rng: () => number, min = 0, max = 1000) => {
  const span = max - min;
  const value = min + rng() * span;
  return roundTo(value, 2);
};

const toEditableRow = (row: MatrixRow): EditablePsiRow => {
  const stockStart = row.stock_at_anchor ?? 0;
  const inbound = row.inbound_qty ?? 0;
  const outbound = row.outbound_qty ?? 0;
  const stockClosing = row.stock_closing ?? 0;
  const stdStock = row.stdstock ?? 0;
  const move = row.move ?? 0;
  const gap = stockStart - stdStock;
  const stockFinal = stockClosing + move;
  const gapAfter = stockStart + move - stdStock;
  return {
    sku: row.sku_code,
    skuName: row.sku_name ?? undefined,
    warehouse: row.warehouse_name,
    channel: row.channel,
    category_1: row.category_1 ?? null,
    category_2: row.category_2 ?? null,
    category_3: row.category_3 ?? null,
    stockStart,
    inbound,
    outbound,
    stockClosing,
    stdStock,
    move,
    stockFinal,
    gap,
    gapAfter,
  };
};

const recalcRow = (row: EditablePsiRow): EditablePsiRow => {
  const stockStart = safeNumber(row.stockStart);
  const stdStock = safeNumber(row.stdStock);
  const move = safeNumber(row.move);
  const stockClosing = safeNumber(row.stockClosing);
  const gap = roundTo(stockStart - stdStock, 2);
  const stockFinal = roundTo(stockClosing + move, 2);
  const gapAfter = roundTo(stockStart + move - stdStock, 2);
  return {
    ...row,
    stockStart: roundTo(stockStart, 2),
    stdStock: roundTo(stdStock, 2),
    stockClosing: roundTo(stockClosing, 2),
    move: roundTo(move, 2),
    gap,
    stockFinal,
    gapAfter,
  };
};

const buildInitialRows = (metadata: TestAlgoMetadata, seedInput: string) => {
  const seedSource = seedInput.trim() ? seedInput.trim() : `${Date.now()}`;
  const seedNumber = createSeedFromString(seedSource);
  const rng = mulberry32(seedNumber || 1);
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const skuCount = Math.max(1, DEFAULT_SKU_COUNT);
  const skuList: string[] = [];
  const rows: EditablePsiRow[] = [];

  for (let index = 0; index < skuCount; index += 1) {
    const skuCode = `SKU-${timestamp}-${index + 1}`;
    skuList.push(skuCode);
    metadata.warehouses.forEach((warehouse) => {
      metadata.channels.forEach((channel) => {
        const stockStart = randomMetric(rng, 50, 500);
        const inbound = randomMetric(rng, 0, 200);
        const outbound = randomMetric(rng, 0, 200);
        const stockClosing = randomMetric(rng, 0, 600);
        const stdStock = randomMetric(rng, 50, 450);
        rows.push(
          recalcRow({
            sku: skuCode,
            skuName: `Test SKU ${index + 1}`,
            warehouse: warehouse.warehouse_name,
            channel,
            category_1: null,
            category_2: null,
            category_3: null,
            stockStart,
            inbound,
            outbound,
            stockClosing,
            stdStock,
            move: 0,
            stockFinal: 0,
            gap: 0,
            gapAfter: 0,
          }),
        );
      });
    });
  }

  return { rows, skuList, seedLabel: seedSource };
};

const metricLabel = (metric: MetricKey, metrics: MetricDefinition[]) =>
  metrics.find((item) => item.key === metric)?.label ?? metric;

const sumMetric = (rows: EditablePsiRow[], metric: MetricKey) =>
  roundTo(rows.reduce((total, row) => total + safeNumber(row[metric] as number | undefined), 0), 2);

const buildMarkdownReport = (
  rows: EditablePsiRow[],
  moves: RecommendedMoveSuggestion[],
  metadata: TestAlgoMetadata | undefined,
  seedLabel: string,
) => {
  const lines: string[] = [];
  const generatedAt = new Date().toISOString();
  lines.push("# Test_Algo Report");
  lines.push("");
  lines.push(`- Generated at: ${generatedAt}`);
  if (seedLabel) {
    lines.push(`- Seed: \`${seedLabel}\``);
  }
  lines.push(`- SKUs: ${new Set(rows.map((row) => row.sku)).size}`);
  if (metadata) {
    lines.push(`- Warehouses: ${metadata.warehouses.length}`);
    lines.push(`- Channels: ${metadata.channels.length}`);
  }
  lines.push("");
  lines.push("## Input totals");
  lines.push("| Metric | Total |");
  lines.push("| --- | ---: |");
  ("stockStart,inbound,outbound,stockClosing,stdStock,gap,stockFinal,gapAfter".split(",") as MetricKey[]).forEach(
    (metric) => {
      lines.push(`| ${metric} | ${sumMetric(rows, metric).toLocaleString()} |`);
    },
  );
  lines.push("");
  lines.push("## Recommended moves");
  if (moves.length === 0) {
    lines.push("No recommended transfers.");
  } else {
    lines.push(
      "| SKU | From warehouse | From channel | To warehouse | To channel | Qty | Reason |",
    );
    lines.push("| --- | --- | --- | --- | --- | ---: | --- |");
    moves.forEach((move) => {
      lines.push(
        `| ${move.sku_code} | ${move.from_warehouse} | ${move.from_channel} | ${move.to_warehouse} | ${move.to_channel} | ${roundTo(move.qty, 2).toLocaleString()} | ${move.reason} |`,
      );
    });
  }
  return lines.join("\n");
};

export default function TestAlgoPage() {
  const metadataQuery = useTestAlgoMetadata();
  const runMutation = useTestAlgoRunMutation();

  const [rows, setRows] = useState<EditablePsiRow[]>([]);
  const [skuList, setSkuList] = useState<string[]>([]);
  const [activeSkuIndex, setActiveSkuIndex] = useState(0);
  const [seedInput, setSeedInput] = useState("");
  const [seedLabel, setSeedLabel] = useState("");
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [swapSource, setSwapSource] = useState<SelectedCell | null>(null);
  const [recommendedMoves, setRecommendedMoves] = useState<RecommendedMoveSuggestion[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const metadata = metadataQuery.data;

  const hasMasters = Boolean(metadata?.warehouses.length && metadata?.channels.length);

  useEffect(() => {
    if (rows.length === 0 && metadataQuery.isSuccess && hasMasters) {
      const initial = buildInitialRows(metadata!, seedInput);
      setRows(initial.rows);
      setSkuList(initial.skuList);
      setSeedLabel(initial.seedLabel);
      setActiveSkuIndex(0);
      setStatusMessage("Generated initial dataset.");
    }
  }, [metadata, metadataQuery.isSuccess, hasMasters, rows.length, seedInput]);

  const activeSku = skuList[activeSkuIndex] ?? null;
  const rowsForActiveSku = useMemo(
    () => (activeSku ? rows.filter((row) => row.sku === activeSku) : []),
    [activeSku, rows],
  );

  const columnGroups = useMemo(() => buildColumnGroups(rowsForActiveSku), [rowsForActiveSku]);
  const headerColumns = useMemo<DisplayColumn[]>(
    () =>
      columnGroups.flatMap((group) =>
        group.channels.map((channel) => ({
          key: makeColumnKey(group.warehouse, channel),
          warehouse: group.warehouse,
          channel,
        })),
      ),
    [columnGroups],
  );

  const activeRowMap = useMemo(() => {
    const map = new Map<string, EditablePsiRow>();
    rowsForActiveSku.forEach((row) => {
      map.set(makeColumnKey(row.warehouse, row.channel), row);
    });
    return map;
  }, [rowsForActiveSku]);

  const handleReset = useCallback(() => {
    if (!metadata || !hasMasters) {
      return;
    }
    const next = buildInitialRows(metadata, seedInput);
    setRows(next.rows);
    setSkuList(next.skuList);
    setActiveSkuIndex(0);
    setSeedLabel(next.seedLabel);
    setRecommendedMoves([]);
    setMarkdown("");
    setSwapSource(null);
    setStatusMessage(`Dataset regenerated with seed \`${next.seedLabel}\`.`);
    setCopyStatus(null);
  }, [metadata, seedInput, hasMasters]);

  const handleMetricChange = useCallback(
    (columnKey: string, metric: MetricKey, value: number) => {
      if (!activeSku || !EDITABLE_METRICS.includes(metric)) {
        return;
      }
      setRows((prev) =>
        prev.map((row) => {
          if (row.sku !== activeSku) {
            return row;
          }
          if (makeColumnKey(row.warehouse, row.channel) !== columnKey) {
            return row;
          }
          const nextRow = { ...row, [metric]: value } as EditablePsiRow;
          return recalcRow(nextRow);
        }),
      );
      setRecommendedMoves([]);
      setMarkdown("");
      setStatusMessage(null);
      setCopyStatus(null);
    },
    [activeSku],
  );

  const handleSelectCell = useCallback(
    (columnKey: string, metric: MetricKey) => {
      if (!activeSku || !EDITABLE_METRICS.includes(metric)) {
        return;
      }
      const currentValue = activeRowMap.get(columnKey);
      if (!currentValue) {
        return;
      }
      if (!swapSource || swapSource.metric !== metric || swapSource.sku !== activeSku) {
        setSwapSource({ sku: activeSku, metric, columnKey });
        setStatusMessage(`Selected ${metricLabel(metric, METRIC_DEFINITIONS)} at ${columnKey}.`);
        return;
      }
      if (swapSource.columnKey === columnKey) {
        setSwapSource(null);
        setStatusMessage(null);
        return;
      }
      const sourceRow = activeRowMap.get(swapSource.columnKey);
      if (!sourceRow) {
        setSwapSource(null);
        return;
      }
      const targetRow = activeRowMap.get(columnKey);
      if (!targetRow) {
        setSwapSource(null);
        return;
      }
      const sourceValue = safeNumber(sourceRow[metric] as number | undefined);
      const targetValue = safeNumber(targetRow[metric] as number | undefined);
      setRows((prev) =>
        prev.map((row) => {
          if (row.sku !== activeSku) {
            return row;
          }
          const key = makeColumnKey(row.warehouse, row.channel);
          if (key === swapSource.columnKey) {
            return recalcRow({ ...row, [metric]: targetValue } as EditablePsiRow);
          }
          if (key === columnKey) {
            return recalcRow({ ...row, [metric]: sourceValue } as EditablePsiRow);
          }
          return row;
        }),
      );
      setSwapSource(null);
      setRecommendedMoves([]);
      setMarkdown("");
      setStatusMessage(
        `Swapped ${metricLabel(metric, METRIC_DEFINITIONS)} between ${swapSource.columnKey} and ${columnKey}.`,
      );
      setCopyStatus(null);
    },
    [activeSku, activeRowMap, swapSource],
  );

  const handleRun = useCallback(async () => {
    if (!metadata || rows.length === 0) {
      return;
    }
    const request: TestAlgoRunRequest = {
      rows: rows.map<TestAlgoRowInput>((row) => ({
        sku_code: String(row.sku),
        sku_name: row.skuName ?? null,
        warehouse_name: row.warehouse,
        channel: row.channel,
        stock_start: safeNumber(row.stockStart),
        inbound: safeNumber(row.inbound),
        outbound: safeNumber(row.outbound),
        stock_closing: safeNumber(row.stockClosing),
        std_stock: safeNumber(row.stdStock),
      })),
    };
    try {
      const response = await runMutation.mutateAsync(request);
      const nextRows = response.matrix_rows.map(toEditableRow);
      const nextSkuList = Array.from(new Set(nextRows.map((row) => String(row.sku))));
      setRows(nextRows.map(recalcRow));
      setSkuList(nextSkuList);
      setActiveSkuIndex((prev) => (prev < nextSkuList.length ? prev : 0));
      setRecommendedMoves(response.recommended_moves);
      setStatusMessage(`Calculated recommendations for ${nextSkuList.length} SKU(s).`);
      setCopyStatus(null);
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to run algorithm.");
    }
  }, [metadata, rows, runMutation]);

  const handleGenerateReport = useCallback(() => {
    const text = buildMarkdownReport(rows, recommendedMoves, metadata, seedLabel);
    setMarkdown(text);
    setCopyStatus(null);
    setStatusMessage("Markdown report generated.");
  }, [rows, recommendedMoves, metadata, seedLabel]);

  const handleCopyMarkdown = useCallback(async () => {
    if (!markdown) {
      return;
    }
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyStatus("Copied to clipboard.");
    } catch (error) {
      setCopyStatus(error instanceof Error ? error.message : "Copy failed.");
    }
  }, [markdown]);

  const handlePrevSku = () => {
    setActiveSkuIndex((prev) => Math.max(0, prev - 1));
  };

  const handleNextSku = () => {
    setActiveSkuIndex((prev) => {
      if (skuList.length === 0) {
        return 0;
      }
      return Math.min(skuList.length - 1, prev + 1);
    });
  };

  const isLoading = metadataQuery.isLoading || runMutation.isPending;

  return (
    <div className="page test-algo-page">
      <h1>Test_Algo</h1>

      <section className="control-panel">
        <h2>データ生成</h2>
        {metadataQuery.isLoading && <p>Loading master data…</p>}
        {metadataQuery.error && <p className="error-text">Failed to load masters.</p>}
        {metadata && !hasMasters && (
          <p className="error-text">Master data is empty. Please register warehouses and channels.</p>
        )}
        <div className="control-grid">
          <label>
            シード値
            <input
              type="text"
              value={seedInput}
              onChange={(event) => setSeedInput(event.target.value)}
              placeholder="任意の文字列"
            />
          </label>
          <div className="control-buttons">
            <button type="button" onClick={handleReset} disabled={!hasMasters || isLoading}>
              Reset
            </button>
            <button type="button" onClick={handleRun} disabled={rows.length === 0 || runMutation.isPending}>
              {runMutation.isPending ? "計算中…" : "計算"}
            </button>
          </div>
        </div>
        {statusMessage ? <p className="status-text">{statusMessage}</p> : null}
      </section>

      <section className="matrix-section">
        <div className="matrix-header">
          <h2>PSI Matrix</h2>
          <div className="sku-navigation">
            <button type="button" onClick={handlePrevSku} disabled={activeSkuIndex <= 0}>
              ‹ Prev
            </button>
            <span>{activeSku ? `${activeSkuIndex + 1} / ${skuList.length}` : "0 / 0"}</span>
            <button
              type="button"
              onClick={handleNextSku}
              disabled={activeSkuIndex >= skuList.length - 1 || skuList.length === 0}
            >
              Next ›
            </button>
          </div>
        </div>
        {!activeSku && <p>No SKU selected.</p>}
        {activeSku && headerColumns.length === 0 && <p>No data for the selected SKU.</p>}
        {activeSku && headerColumns.length > 0 && (
          <div className="psi-matrix-scroll">
            <table className="psi-matrix-table">
              <thead>
                <tr>
                  <th rowSpan={2} className="metric-column">
                    Metric
                  </th>
                  {columnGroups.map((group) => (
                    <th key={group.warehouse} colSpan={group.channels.length} className="warehouse-header">
                      {group.warehouse}
                    </th>
                  ))}
                </tr>
                <tr>
                  {columnGroups.flatMap((group) =>
                    group.channels.map((channel) => (
                      <th key={makeColumnKey(group.warehouse, channel)} className="channel-header">
                        {channel}
                      </th>
                    )),
                  )}
                </tr>
              </thead>
              <tbody>
                {METRIC_DEFINITIONS.map((metric) => (
                  <tr key={metric.key}>
                    <th scope="row" className="metric-label">
                      {metric.label}
                    </th>
                    {headerColumns.map((column) => {
                      const columnKey = column.key;
                      const row = activeRowMap.get(columnKey);
                      const value = row ? (row[metric.key] as number | undefined) : undefined;
                      if (EDITABLE_METRICS.includes(metric.key)) {
                        const isSelected =
                          swapSource?.metric === metric.key && swapSource?.columnKey === columnKey;
                        return (
                          <td key={columnKey} className={`editable-cell ${isSelected ? "selected" : ""}`}>
                            <div className="editable-cell-inner">
                              <input
                                type="number"
                                step="0.01"
                                value={typeof value === "number" ? value : 0}
                                onChange={(event) => {
                                  const parsed = Number(event.target.value);
                                  handleMetricChange(
                                    columnKey,
                                    metric.key,
                                    Number.isFinite(parsed) ? parsed : 0,
                                  );
                                }}
                              />
                              <button
                                type="button"
                                className="swap-button"
                                onClick={() => handleSelectCell(columnKey, metric.key)}
                              >
                                Swap
                              </button>
                            </div>
                          </td>
                        );
                      }
                      return (
                        <td key={columnKey} className="value-cell">
                          {formatMetricValue(value)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="plan-lines-section">
        <h2>Transfer Plan Lines</h2>
        {recommendedMoves.length === 0 ? (
          <p>No recommended moves yet.</p>
        ) : (
          <div className="table-wrapper">
            <table className="data-table">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>From warehouse</th>
                  <th>From channel</th>
                  <th>To warehouse</th>
                  <th>To channel</th>
                  <th>Qty</th>
                  <th>Reason</th>
                </tr>
              </thead>
              <tbody>
                {recommendedMoves.map((move, index) => (
                  <tr key={`${move.sku_code}-${index}`}>
                    <td>{move.sku_code}</td>
                    <td>{move.from_warehouse}</td>
                    <td>{move.from_channel}</td>
                    <td>{move.to_warehouse}</td>
                    <td>{move.to_channel}</td>
                    <td className="numeric">{formatMetricValue(move.qty)}</td>
                    <td>{move.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="report-section">
        <h2>Markdown Report</h2>
        <div className="control-buttons">
          <button type="button" onClick={handleGenerateReport} disabled={rows.length === 0}>
            レポート生成
          </button>
          <button type="button" onClick={handleCopyMarkdown} disabled={!markdown}>
            コピー
          </button>
        </div>
        {copyStatus ? <p className="status-text">{copyStatus}</p> : null}
        <textarea value={markdown} readOnly rows={12} />
      </section>
    </div>
  );
}
