import { PSIChannel, PSIDailyEntry } from "../types";

export type MetricKey =
  | "stock_at_anchor"
  | "inbound_qty"
  | "outbound_qty"
  | "net_flow"
  | "stock_closing"
  | "safety_stock"
  | "movable_stock";

export type EditableField = "inbound_qty" | "outbound_qty" | "safety_stock";

export interface PSIEditableDay extends PSIDailyEntry {
  base_stock_at_anchor: number | null;
}

export interface PSIEditableChannel extends Omit<PSIChannel, "daily"> {
  daily: PSIEditableDay[];
}

export interface MetricDefinitionBase {
  key: MetricKey;
  label: string;
  editable?: false;
}

export interface EditableMetricDefinition {
  key: EditableField;
  label: string;
  editable: true;
}

export type MetricDefinition = MetricDefinitionBase | EditableMetricDefinition;

export const metricDefinitions: MetricDefinition[] = [
  { key: "stock_at_anchor", label: "stock_at_anchor" },
  { key: "inbound_qty", label: "inbound_qty", editable: true },
  { key: "outbound_qty", label: "outbound_qty", editable: true },
  { key: "net_flow", label: "net_flow" },
  { key: "stock_closing", label: "stock_closing" },
  { key: "safety_stock", label: "safety_stock", editable: true },
  { key: "movable_stock", label: "movable_stock" },
];

export const isEditableMetric = (
  metric: MetricDefinition
): metric is EditableMetricDefinition => metric.editable === true;
