import { useCallback, useEffect, useMemo, useState } from "react";

import { buildColumnGroups, makeColumnKey, METRIC_DEFINITIONS, safeNumber } from "../features/reallocation/psi/utils";
import type { MetricKey, PsiRow } from "../features/reallocation/psi/types";
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

interface DisplayColumn {
  key: string;
  warehouse: string;
  channel: string;
}

const DEFAULT_SKU_COUNT = 3;
const DEFAULT_WAREHOUSE_COUNT = 2;

const toInteger = (value: number) => Math.round(value);

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
  return toInteger(value);
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
  const inbound = safeNumber(row.inbound);
  const outbound = safeNumber(row.outbound);
  const stockStartInt = toInteger(stockStart);
  const inboundInt = toInteger(inbound);
  const outboundInt = toInteger(outbound);
  const stdStockInt = toInteger(stdStock);
  const moveInt = toInteger(move);
  const stockClosingInt = toInteger(stockClosing);
  const gap = toInteger(stockStartInt - stdStockInt);
  const stockFinal = toInteger(stockClosingInt + moveInt);
  const gapAfter = toInteger(stockStartInt + moveInt - stdStockInt);
  return {
    ...row,
    stockStart: stockStartInt,
    inbound: inboundInt,
    outbound: outboundInt,
    stdStock: stdStockInt,
    stockClosing: stockClosingInt,
    move: moveInt,
    gap,
    stockFinal,
    gapAfter,
  };
};

const buildInitialRows = (metadata: TestAlgoMetadata, warehouseCount: number) => {
  const seedNumber = Date.now() >>> 0;
  const rng = mulberry32(seedNumber || 1);
  const timestamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const skuCount = Math.max(1, DEFAULT_SKU_COUNT);
  const skuList: string[] = [];
  const rows: EditablePsiRow[] = [];
  const availableWarehouses = metadata.warehouses.slice(
    0,
    Math.max(1, Math.min(warehouseCount, metadata.warehouses.length)),
  );

  for (let index = 0; index < skuCount; index += 1) {
    const skuCode = `SKU-${timestamp}-${index + 1}`;
    skuList.push(skuCode);
    availableWarehouses.forEach((warehouse) => {
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

  return { rows, skuList };
};

const sumMetric = (rows: EditablePsiRow[], metric: MetricKey) =>
  toInteger(rows.reduce((total, row) => total + safeNumber(row[metric] as number | undefined), 0));

const makeMoveKey = (sku: string | number, warehouse: string, channel: string) =>
  `${String(sku)}|||${warehouse}|||${channel}`;

const applyMovesToRows = (rows: EditablePsiRow[], moves: RecommendedMoveSuggestion[]) => {
  if (moves.length === 0) {
    return rows.map(recalcRow);
  }
  const moveMap = new Map<string, number>();
  moves.forEach((move) => {
    const qty = toInteger(move.qty);
    if (!qty) {
      return;
    }
    const fromKey = makeMoveKey(move.sku_code, move.from_warehouse, move.from_channel);
    const toKey = makeMoveKey(move.sku_code, move.to_warehouse, move.to_channel);
    moveMap.set(fromKey, (moveMap.get(fromKey) ?? 0) - qty);
    moveMap.set(toKey, (moveMap.get(toKey) ?? 0) + qty);
  });
  return rows.map((row) => {
    const key = makeMoveKey(row.sku, row.warehouse, row.channel);
    const nextMove = moveMap.has(key) ? moveMap.get(key)! : safeNumber(row.move);
    return recalcRow({ ...row, move: nextMove } as EditablePsiRow);
  });
};

const formatIntegerValue = (value: number | null | undefined): string => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return "-";
  }
  return toInteger(value).toLocaleString();
};

const buildMarkdownReport = (
  rows: EditablePsiRow[],
  moves: RecommendedMoveSuggestion[],
  metadata: TestAlgoMetadata | undefined,
) => {
  const lines: string[] = [];
  const generatedAt = new Date().toISOString();
  lines.push("# Test_Algo Report");
  lines.push("");
  lines.push(`- Generated at: ${generatedAt}`);
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
        `| ${move.sku_code} | ${move.from_warehouse} | ${move.from_channel} | ${move.to_warehouse} | ${move.to_channel} | ${toInteger(move.qty).toLocaleString()} | ${move.reason} |`,
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
  const [warehouseCount, setWarehouseCount] = useState(DEFAULT_WAREHOUSE_COUNT);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [recommendedMoves, setRecommendedMoves] = useState<RecommendedMoveSuggestion[]>([]);
  const [markdown, setMarkdown] = useState("");
  const [copyStatus, setCopyStatus] = useState<string | null>(null);

  const metadata = metadataQuery.data;
  const warehouseLimit = metadata?.warehouses.length ?? 0;

  const hasMasters = Boolean(metadata?.warehouses.length && metadata?.channels.length);

  useEffect(() => {
    if (warehouseLimit > 0) {
      setWarehouseCount((prev) => {
        const min = 1;
        const max = warehouseLimit;
        const fallback = Math.min(DEFAULT_WAREHOUSE_COUNT, max);
        if (!Number.isFinite(prev) || prev < min) {
          return fallback;
        }
        if (prev > max) {
          return max;
        }
        return prev;
      });
    }
  }, [warehouseLimit]);

  const regenerateDataset = useCallback(
    (message?: string) => {
      if (!metadata || !hasMasters) {
        return null;
      }
      const initial = buildInitialRows(metadata, warehouseCount);
      const normalizedRows = initial.rows.map(recalcRow);
      setRows(normalizedRows);
      setSkuList(initial.skuList);
      setActiveSkuIndex(0);
      setRecommendedMoves([]);
      setMarkdown("");
      setCopyStatus(null);
      const effectiveCount = Math.min(warehouseCount, metadata.warehouses.length);
      setStatusMessage(
        message ?? `倉庫数${effectiveCount}件でデータセットを再生成しました。`,
      );
      return { rows: normalizedRows, skuList: initial.skuList };
    },
    [metadata, hasMasters, warehouseCount],
  );

  useEffect(() => {
    if (rows.length === 0 && metadataQuery.isSuccess && hasMasters) {
      regenerateDataset("初期データを生成しました。");
    }
  }, [metadataQuery.isSuccess, hasMasters, regenerateDataset, rows.length]);

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
    regenerateDataset();
  }, [regenerateDataset]);

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
          const nextValue = toInteger(value);
          const nextRow = { ...row, [metric]: nextValue } as EditablePsiRow;
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
  const runAlgorithm = useCallback(
    async (inputRows: EditablePsiRow[]) => {
      if (!metadata || inputRows.length === 0) {
        return null;
      }
      const request: TestAlgoRunRequest = {
        rows: inputRows.map<TestAlgoRowInput>((row) => ({
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
      const response = await runMutation.mutateAsync(request);
      const recalculatedRows = response.matrix_rows.map(toEditableRow).map(recalcRow);
      const rowsWithMoves = applyMovesToRows(recalculatedRows, response.recommended_moves);
      const nextSkuList = Array.from(new Set(rowsWithMoves.map((row) => String(row.sku))));
      setRows(rowsWithMoves);
      setSkuList(nextSkuList);
      setActiveSkuIndex((prev) => (prev < nextSkuList.length ? prev : 0));
      setRecommendedMoves(response.recommended_moves);
      setCopyStatus(null);
      return { rows: rowsWithMoves, moves: response.recommended_moves, skuList: nextSkuList };
    },
    [metadata, runMutation],
  );

  const handleRun = useCallback(async () => {
    try {
      const result = await runAlgorithm(rows);
      if (result) {
        setStatusMessage(`Calculated recommendations for ${result.skuList.length} SKU(s).`);
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "Failed to run algorithm.");
    }
  }, [rows, runAlgorithm]);

  const handleGenerateReport = useCallback(() => {
    const text = buildMarkdownReport(rows, recommendedMoves, metadata);
    setMarkdown(text);
    setCopyStatus(null);
    setStatusMessage("Markdown report generated.");
  }, [rows, recommendedMoves, metadata]);

  const handleFullProcess = useCallback(async () => {
    if (!metadata || !hasMasters) {
      return;
    }
    const confirmed = window.confirm("ダイアグラムとかで実行しますがいいですか？");
    if (!confirmed) {
      return;
    }
    const initial = regenerateDataset();
    if (!initial) {
      return;
    }
    try {
      const result = await runAlgorithm(initial.rows);
      if (result) {
        const reportText = buildMarkdownReport(result.rows, result.moves, metadata);
        setMarkdown(reportText);
        setCopyStatus(null);
        setStatusMessage("一括実行が完了しました。");
      }
    } catch (error) {
      setStatusMessage(error instanceof Error ? error.message : "処理に失敗しました。");
    }
  }, [metadata, hasMasters, regenerateDataset, runAlgorithm]);

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
            倉庫数
            <input
              type="number"
              min={1}
              max={Math.max(1, warehouseLimit || 1)}
              value={warehouseCount}
              onChange={(event) => {
                const parsed = Number(event.target.value);
                if (!Number.isFinite(parsed)) {
                  setWarehouseCount(1);
                  return;
                }
                const min = 1;
                const max = warehouseLimit > 0 ? warehouseLimit : Math.max(1, warehouseCount);
                const clamped = Math.min(Math.max(Math.round(parsed), min), max);
                setWarehouseCount(clamped);
              }}
              disabled={!hasMasters || isLoading}
            />
          </label>
          <div className="control-buttons">
            <button
              type="button"
              className="btn-reset"
              onClick={handleReset}
              disabled={!hasMasters || isLoading}
            >
              Reset
            </button>
            <button
              type="button"
              className="btn-run"
              onClick={handleRun}
              disabled={rows.length === 0 || runMutation.isPending}
            >
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
                        return (
                          <td key={columnKey} className="editable-cell">
                            <div className="editable-cell-inner">
                              <input
                                type="number"
                                step={1}
                                value={typeof value === "number" ? toInteger(value) : 0}
                                onChange={(event) => {
                                  const parsed = Number(event.target.value);
                                  handleMetricChange(
                                    columnKey,
                                    metric.key,
                                    Number.isFinite(parsed) ? parsed : 0,
                                  );
                                }}
                              />
                            </div>
                          </td>
                        );
                      }
                      return (
                        <td key={columnKey} className="value-cell">
                          {formatIntegerValue(value)}
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
                    <td className="numeric">{formatIntegerValue(move.qty)}</td>
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
        <div className="control-buttons report-buttons">
          <button type="button" onClick={handleGenerateReport} disabled={rows.length === 0}>
            レポート生成
          </button>
          <button type="button" onClick={handleCopyMarkdown} disabled={!markdown}>
            コピー
          </button>
          <button
            type="button"
            className="btn-batch"
            onClick={handleFullProcess}
            disabled={!hasMasters || isLoading || runMutation.isPending}
          >
            一括実行
          </button>
        </div>
        {copyStatus ? <p className="status-text">{copyStatus}</p> : null}
        <textarea value={markdown} readOnly rows={12} />
      </section>
    </div>
  );
}
