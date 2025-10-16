import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import CrossTableView from "../../src/features/reallocation/psi/views/CrossTableView";
import HeatmapView from "../../src/features/reallocation/psi/views/HeatmapView";
import { METRIC_DEFINITIONS, orderMetricsByDisplayOrder } from "../../src/features/reallocation/psi/utils";
import type { MetricDefinition, PsiRow } from "../../src/features/reallocation/psi/types";
import type { PSIMetricDefinition } from "../../src/types";

const buildMasterMetrics = (): PSIMetricDefinition[] => [
  { name: "inbound", is_editable: false, display_order: 1 },
  { name: "stock_start", is_editable: false, display_order: 2 },
  { name: "outbound", is_editable: false, display_order: 3 },
  { name: "gap", is_editable: false, display_order: 4 },
  { name: "gap_after", is_editable: false, display_order: 5 },
];

const buildRows = (): PsiRow[] => [
  {
    sku: "SKU-1",
    warehouse: "W1",
    channel: "Online",
    stockStart: 100,
    inbound: 10,
    outbound: 20,
    stockClosing: 90,
    move: 5,
    stockFinal: 95,
    stdStock: 80,
  },
  {
    sku: "SKU-1",
    warehouse: "W1",
    channel: "Store",
    stockStart: 50,
    inbound: 5,
    outbound: 10,
    stockClosing: 45,
    move: -5,
    stockFinal: 40,
    stdStock: 60,
  },
  {
    sku: "SKU-1",
    warehouse: "W2",
    channel: "Online",
    stockStart: 30,
    inbound: 2,
    outbound: 1,
    stockClosing: 31,
    move: 0,
    stockFinal: 31,
    stdStock: 25,
  },
];

const stripHtml = (value: string) => value.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();

const extractMetricLabelsFromTable = (html: string): string[] => {
  const labels: string[] = [];
  const metricCellPattern = /<th\s+scope="row"\s+class="metric-label">([\s\S]*?)<\/th>/g;
  let match: RegExpExecArray | null;
  while ((match = metricCellPattern.exec(html))) {
    const text = stripHtml(match[1]).replace(/\s*i\s*$/, "").trim();
    if (text) {
      labels.push(text);
    }
  }
  return labels;
};

const extractCheckboxLabels = (html: string): string[] => {
  const labels: string[] = [];
  const checkboxPattern = /<label[^>]*class="psi-heatmap-checkbox"[^>]*>[\s\S]*?<span>(.*?)<\/span>[\s\S]*?<\/label>/g;
  let match: RegExpExecArray | null;
  while ((match = checkboxPattern.exec(html))) {
    labels.push(stripHtml(match[1]));
  }
  return labels;
};

const masterMetrics = buildMasterMetrics();
const orderedMetrics: MetricDefinition[] = orderMetricsByDisplayOrder(METRIC_DEFINITIONS, masterMetrics);
const expectedMetricLabels = orderedMetrics.map((metric) => metric.label);
const rows = buildRows();

test("cross table keeps metric order for warehouse-first orientation", () => {
  const markup = renderToStaticMarkup(
    <CrossTableView rows={rows} metrics={orderedMetrics} orientation="warehouse-first" />,
  );
  const labels = extractMetricLabelsFromTable(markup);
  assert.deepEqual(labels, expectedMetricLabels);
});

test("cross table keeps metric order for channel-first orientation", () => {
  const markup = renderToStaticMarkup(
    <CrossTableView rows={rows} metrics={orderedMetrics} orientation="channel-first" />,
  );
  const labels = extractMetricLabelsFromTable(markup);
  assert.deepEqual(labels, expectedMetricLabels);
});

test("heatmap uses metric order for checkboxes and table rows", () => {
  const markup = renderToStaticMarkup(<HeatmapView rows={rows} metrics={orderedMetrics} />);
  const checkboxLabels = extractCheckboxLabels(markup);
  assert.deepEqual(checkboxLabels, expectedMetricLabels);

  const rowLabels = extractMetricLabelsFromTable(markup);
  assert.deepEqual(rowLabels, expectedMetricLabels.filter((label) => label === "Gap" || label === "Gap After"));
});

test("heatmap preserves metric order when restoring selections", () => {
  const customSelection = [orderedMetrics[4].key, orderedMetrics[0].key];
  const markup = renderToStaticMarkup(
    <HeatmapView rows={rows} metrics={orderedMetrics} initialSelection={customSelection} />,
  );
  const rowLabels = extractMetricLabelsFromTable(markup);
  const expectedSelectedLabels = expectedMetricLabels.filter((label) =>
    [orderedMetrics[0].label, orderedMetrics[4].label].includes(label),
  );
  assert.deepEqual(rowLabels, expectedSelectedLabels);
});
