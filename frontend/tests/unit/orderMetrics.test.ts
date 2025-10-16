import assert from "node:assert/strict";
import test from "node:test";

import { normalizeDisplayOrder, orderMetrics } from "../../src/utils/metrics";

test("normalizeDisplayOrder returns numbers as-is", () => {
  assert.equal(normalizeDisplayOrder(5), 5);
  assert.equal(normalizeDisplayOrder(0), 0);
});

test("normalizeDisplayOrder parses numeric strings", () => {
  assert.equal(normalizeDisplayOrder("10"), 10);
  assert.equal(normalizeDisplayOrder("  2.5 "), 2.5);
});

test("normalizeDisplayOrder returns null for invalid values", () => {
  assert.equal(normalizeDisplayOrder(undefined), null);
  assert.equal(normalizeDisplayOrder(null), null);
  assert.equal(normalizeDisplayOrder(""), null);
  assert.equal(normalizeDisplayOrder("abc"), null);
});

test("orderMetrics sorts metrics by numeric display order", () => {
  const metrics = [
    { name: "B", display_order: 20 },
    { name: "A", display_order: 10 },
    { name: "C", display_order: 30 },
  ];

  const result = orderMetrics(metrics);
  assert.deepEqual(
    result.map((metric) => metric.name),
    ["A", "B", "C"],
  );
  result.forEach((metric) => assert.equal(typeof metric.display_order, "number"));
});

test("orderMetrics places undefined display orders at the end", () => {
  const metrics = [
    { name: "B", display_order: null },
    { name: "A" },
    { name: "C", display_order: "5" },
  ];

  const result = orderMetrics(metrics);
  assert.deepEqual(
    result.map((metric) => metric.name),
    ["C", "B", "A"],
  );
  assert.equal(result[0].display_order, 5);
  assert.ok(result[1].display_order >= Number.MAX_SAFE_INTEGER);
  assert.ok(result[2].display_order >= Number.MAX_SAFE_INTEGER);
});

test("orderMetrics preserves original order for identical display orders", () => {
  const metrics = [
    { name: "A", display_order: 1 },
    { name: "B", display_order: 1 },
    { name: "C", display_order: 1 },
  ];

  const result = orderMetrics(metrics);
  assert.deepEqual(
    result.map((metric) => metric.name),
    ["A", "B", "C"],
  );
});
