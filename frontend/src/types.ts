export interface Session {
  id: string;
  title: string;
  description?: string | null;
  is_leader: boolean;
  data_mode: "base" | "summary";
  data_type?: "base" | "summary";
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  created_by_username?: string | null;
  updated_by_username?: string | null;
}

export interface PSIDailyEntry {
  date: string;
  stock_at_anchor?: number | null;
  inbound_qty?: number | null;
  outbound_qty?: number | null;
  channel_move?: number | null;
  net_flow?: number | null;
  stock_closing?: number | null;
  safety_stock?: number | null;
  movable_stock?: number | null;
  stdstock?: number | null;
  gap?: number | null;
  inventory_days?: number | null;
}

export interface PSIChannel {
  sku_code: string;
  sku_name?: string | null;
  category_1?: string | null;
  category_2?: string | null;
  category_3?: string | null;
  fw_rank?: string | null;
  ss_rank?: string | null;
  warehouse_name: string;
  channel: string;
  daily: PSIDailyEntry[];
}

export interface PSISessionSummary {
  session_id: string;
  data_type: "base" | "summary";
  start_date?: string | null;
  end_date?: string | null;
}

export interface PSIReportSettings {
  lead_time_days: number;
  safety_buffer_days: number;
  min_move_qty: number;
  target_days_ahead: number;
  priority_channels?: string[] | null;
}

export interface PSIReportResponse {
  sku_code: string;
  sku_name?: string | null;
  generated_at: string;
  report_markdown: string;
  settings: PSIReportSettings;
}

export interface PSIEditApplyResult {
  applied: number;
  log_entries: number;
  last_edited_by?: string | null;
  last_edited_by_username?: string | null;
  last_edited_at?: string | null;
}

export interface PSIEditRecord {
  id: number;
  session_id: string;
  sku_code: string;
  warehouse_name: string;
  channel: string;
  date: string;
  inbound_qty?: number | null;
  outbound_qty?: number | null;
  safety_stock?: number | null;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  updated_by?: string | null;
  created_by_username?: string | null;
  updated_by_username?: string | null;
}

export interface ChannelTransferIdentifier {
  session_id: string;
  sku_code: string;
  warehouse_name: string;
  transfer_date: string;
  from_channel: string;
  to_channel: string;
}

export interface ChannelTransferCreate extends ChannelTransferIdentifier {
  qty: number;
  note?: string | null;
}

export interface ChannelTransfer extends ChannelTransferCreate {
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  updated_by?: string | null;
  created_by_username?: string | null;
  updated_by_username?: string | null;
}

export interface MatrixRow {
  sku_code: string;
  sku_name?: string | null;
  warehouse_name: string;
  channel: string;
  category_1?: string | null;
  category_2?: string | null;
  category_3?: string | null;
  stock_at_anchor: number;
  inbound_qty: number;
  outbound_qty: number;
  stock_closing: number;
  stdstock: number;
  gap: number;
  move: number;
  stock_fin: number;
}

export interface TestAlgoWarehouseMeta {
  warehouse_name: string;
  main_channel?: string | null;
}

export interface TestAlgoMetadata {
  warehouses: TestAlgoWarehouseMeta[];
  channels: string[];
}

export interface TestAlgoRowInput {
  sku_code: string;
  sku_name?: string | null;
  warehouse_name: string;
  channel: string;
  stock_start: number;
  inbound: number;
  outbound: number;
  stock_closing: number;
  std_stock: number;
}

export interface TestAlgoRunRequest {
  rows: TestAlgoRowInput[];
}

export interface RecommendedMoveSuggestion {
  sku_code: string;
  from_warehouse: string;
  from_channel: string;
  to_warehouse: string;
  to_channel: string;
  qty: number;
  reason: string;
}

export interface TestAlgoRunResponse {
  matrix_rows: MatrixRow[];
  recommended_moves: RecommendedMoveSuggestion[];
}

export type TransferPlanStatus = "draft" | "confirmed" | "applied" | "cancelled";

export interface TransferPlan {
  plan_id: string;
  session_id: string;
  start_date: string;
  end_date: string;
  status: TransferPlanStatus;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  updated_by?: string | null;
}

export interface TransferPlanLine {
  line_id: string;
  plan_id: string;
  sku_code: string;
  from_warehouse: string;
  from_channel: string;
  to_warehouse: string;
  to_channel: string;
  qty: number;
  is_manual: boolean;
  reason?: string | null;
}

export interface TransferPlanWithLines {
  plan: TransferPlan;
  lines: TransferPlanLine[];
}

export interface UploadResponse {
  ok: boolean;
  mode: "base" | "summary";
  rows: number;
  rows_imported: number;
  session_id: string;
  dates: string[];
  warnings: string[];
}

export interface PSIMetricDefinition {
  name: string;
  is_editable: boolean;
  display_order: number;
}

export interface WarehouseMaster {
  warehouse_name: string;
  region?: string | null;
  main_channel?: string | null;
}

export interface CategoryRankParameter {
  rank_type: string;
  category_1: string;
  category_2: string;
  threshold: string;
}

export interface MasterRecord {
  id: string;
  master_type: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface UserAccount {
  id: string;
  username: string;
  is_active: boolean;
  is_admin: boolean;
  created_at: string;
}

export interface ReallocationPolicy {
  take_from_other_main: boolean;
  rounding_mode: "floor" | "round" | "ceil";
  allow_overfill: boolean;
  fair_share_mode: "off" | "equalize_ratio_closing" | "equalize_ratio_start";
  deficit_basis: "start" | "closing";
  updated_at?: string | null;
  updated_by?: string | null;
}
