import { SummaryRow } from "./psiSummary";

export type SummaryFilterDefinition = {
  id: string;
  label: string;
  description: string;
  predicate: (row: SummaryRow) => boolean;
};

const getChannelValues = (row: SummaryRow) => Object.values(row.channels);

const sumOutbound = (row: SummaryRow) =>
  getChannelValues(row).reduce((total, channel) => total + (channel.outbound_sum ?? 0), 0);

const hasNegativeClosing = (row: SummaryRow) =>
  getChannelValues(row).some((channel) => (channel.last_closing ?? 0) < 0);

const hasSafetyShortage = (row: SummaryRow) =>
  getChannelValues(row).some((channel) => {
    const closing = channel.last_closing;
    const safety = channel.last_safety_stock;
    if (closing === null || safety === null) {
      return false;
    }
    return closing < safety;
  });

const hasMovableStock = (row: SummaryRow) =>
  getChannelValues(row).some((channel) => {
    const movable = channel.last_movable_stock;
    if (movable === null || movable === undefined) {
      return false;
    }
    return movable > 0;
  });

export const summaryFilters: SummaryFilterDefinition[] = [
  {
    id: "outboundTotal>=1",
    label: "出庫数量が1以上",
    description: "いずれかのチャネルで出庫実績があるSKUを表示します。",
    predicate: (row) => sumOutbound(row) >= 1,
  },
  {
    id: "hasNegativeStockClosing",
    label: "在庫残がマイナス",
    description: "最新の在庫残高がマイナスのチャネルを含むSKUを表示します。",
    predicate: (row) => hasNegativeClosing(row),
  },
  {
    id: "safetyStockShortage",
    label: "安全在庫を下回る",
    description: "在庫残高が安全在庫を下回っているSKUを表示します。",
    predicate: (row) => hasSafetyShortage(row),
  },
  {
    id: "hasMovableStock",
    label: "移動可能在庫あり",
    description: "移動可能在庫が正の値のSKUを表示します。",
    predicate: (row) => hasMovableStock(row),
  },
];

const summaryFilterMap = new Map(summaryFilters.map((filter) => [filter.id, filter]));

export function resolveSummaryFilter(id: string): SummaryFilterDefinition | undefined {
  return summaryFilterMap.get(id);
}

export function applySummaryFilters(rows: SummaryRow[], filterIds: string[]): SummaryRow[] {
  if (!filterIds.length) {
    return rows;
  }

  const predicates = filterIds
    .map((id) => summaryFilterMap.get(id))
    .filter((filter): filter is SummaryFilterDefinition => Boolean(filter))
    .map((filter) => filter.predicate);

  if (!predicates.length) {
    return rows;
  }

  return rows.filter((row) => predicates.every((predicate) => predicate(row)));
}
