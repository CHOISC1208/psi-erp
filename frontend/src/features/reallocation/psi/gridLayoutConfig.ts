export type RowDensityMode = "auto" | "fixed";

const DEFAULT_GROUP_ORDER = [
  "住商グローバル・ロジスティクス",
  "名鉄運輸",
  "三井倉庫",
  "上組",
  "日通",
];

const DEFAULT_CHANNEL_ORDER = [
  "online",
  "retail",
  "wholesale",
  "outlet",
  "other",
];

export const PSI_GRID_CONFIG = {
  widths: {
    metric: 180,
    total: 96,
    value: 118,
  },
  compact: {
    enabledByDefault: false,
    rowHeight: 28,
    lineHeight: 1.2,
  },
  defaultRowHeight: 38,
  pinnedLeft: ["metric", "total"] as const,
  groupOrder: DEFAULT_GROUP_ORDER,
  channelOrder: DEFAULT_CHANNEL_ORDER,
  warehouseAbbreviations: {
    "住商グローバル・ロジスティクス": "住商GL",
    "名鉄運輸": "名鉄",
    "三井倉庫": "三井",
    "上組": "上組",
    "日通": "日通",
  } as Record<string, string>,
  channelAbbreviations: {
    online: "ONL",
    retail: "RTL",
    wholesale: "WHO",
    outlet: "OUT",
    other: "OTH",
  } as Record<string, string>,
};

export interface GridStateConfig {
  compactMode: boolean;
  rowDensity: RowDensityMode;
}

export const createDefaultGridState = (): GridStateConfig => ({
  compactMode: PSI_GRID_CONFIG.compact.enabledByDefault,
  rowDensity: "auto",
});
