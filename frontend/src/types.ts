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

export interface MasterRecord {
  id: string;
  master_type: string;
  data: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}
