import { PSIChannel, PSIDailyEntry } from "../types";

export type MetricKey =
  | "stock_at_anchor"
  | "inbound_qty"
  | "outbound_qty"
  | "channel_move"
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

export type PSIGridRowType = "channel" | "metric";

export interface PSIGridRowBase {
  id: string;
  channelKey: string;
  sku_code: string;
  warehouse_name: string;
  channel: string;
  metric: string;
  metricEditable: boolean;
  rowType: PSIGridRowType;
  collapsed?: boolean;
}

export interface PSIGridMetricRow extends PSIGridRowBase {
  rowType: "metric";
  metricKey: MetricKey;
  [key: string]: number | null | string | boolean | undefined;
}

export interface PSIGridChannelRow extends PSIGridRowBase {
  rowType: "channel";
  metricKey?: undefined;
  [key: string]: number | null | string | boolean | undefined;
}

export type PSIGridRow = PSIGridMetricRow | PSIGridChannelRow;

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
  { key: "channel_move", label: "channel_move" },
  { key: "net_flow", label: "net_flow" },
  { key: "stock_closing", label: "stock_closing" },
  { key: "safety_stock", label: "safety_stock", editable: true },
  { key: "movable_stock", label: "movable_stock" },
];

export const isEditableMetric = (
  metric: MetricDefinition
): metric is EditableMetricDefinition => metric.editable === true;
