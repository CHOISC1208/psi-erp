export interface Session {
  id: string;
  title: string;
  description?: string | null;
  is_leader: boolean;
  created_at: string;
  updated_at: string;
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
}

export interface PSIChannel {
  sku_code: string;
  sku_name?: string | null;
  warehouse_name: string;
  channel: string;
  daily: PSIDailyEntry[];
}

export interface PSISessionSummary {
  session_id: string;
  start_date?: string | null;
  end_date?: string | null;
}

export interface PSIEditApplyResult {
  applied: number;
  log_entries: number;
  last_edited_by?: string | null;
  last_edited_by_username?: string | null;
  last_edited_at?: string | null;
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
}

export interface PSIMetricDefinition {
  name: string;
  is_editable: boolean;
  display_order: number;
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
  password: string;
}
