export interface PsiRowMetrics {
  stockStart?: number;
  inbound?: number;
  outbound?: number;
  stockClosing?: number;
  stdStock?: number;
  gap?: number;
  move?: number;
  stockFinal?: number;
  gapAfter?: number;
}

export type MetricKey = keyof PsiRowMetrics;

export interface PsiRowBase {
  sku: string | number;
  skuName?: string;
  warehouse: string;
  channel: string;
}

export type PsiRow = PsiRowBase & PsiRowMetrics;

export interface MetricDefinition {
  key: MetricKey;
  label: string;
  shortLabel?: string;
  description?: string;
}

export interface ColumnGroup {
  warehouse: string;
  channels: string[];
}

export interface ColumnKey {
  key: string;
  warehouse: string;
  channel: string;
}
