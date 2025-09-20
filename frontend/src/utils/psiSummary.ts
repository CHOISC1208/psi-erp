import { PSIChannel } from "../types";

export type ChannelAgg = {
  inbound_sum: number;
  outbound_sum: number;
  last_closing: number | null;
  last_safety_stock: number | null;
  last_movable_stock: number | null;
};

export type SummaryRow = {
  sku_code: string;
  sku_name?: string;
  channels: Record<string, ChannelAgg>;
};

const parseDate = (value: string) => new Date(`${value}T00:00:00Z`).getTime();

export function buildSummary(psi: PSIChannel[], start?: string | null, end?: string | null): SummaryRow[] {
  if (!psi.length) {
    return [];
  }

  const startTime = start ? parseDate(start) : null;
  const endTime = end ? parseDate(end) : null;
  const rows = new Map<string, SummaryRow>();
  const channelDates = new Map<string, string | null>();

  psi.forEach((channel) => {
    const existing = rows.get(channel.sku_code);
    const summary: SummaryRow = existing ?? {
      sku_code: channel.sku_code,
      sku_name: channel.sku_name ?? undefined,
      channels: {},
    };

    if (!summary.sku_name && channel.sku_name) {
      summary.sku_name = channel.sku_name;
    }

    const stateKeyPrefix = `${channel.sku_code}::${channel.channel}`;
    const current = summary.channels[channel.channel] ?? {
      inbound_sum: 0,
      outbound_sum: 0,
      last_closing: null,
      last_safety_stock: null,
      last_movable_stock: null,
    };

    channel.daily.forEach((entry) => {
      const entryTime = parseDate(entry.date);
      if (startTime !== null && entryTime < startTime) {
        return;
      }
      if (endTime !== null && entryTime > endTime) {
        return;
      }

      current.inbound_sum += entry.inbound_qty ?? 0;
      current.outbound_sum += entry.outbound_qty ?? 0;

      const lastDateKey = `${stateKeyPrefix}::date`;
      const previousDate = channelDates.get(lastDateKey);
      if (!previousDate || entry.date >= previousDate) {
        channelDates.set(lastDateKey, entry.date);
        const closing = entry.stock_closing ?? null;
        const safety = entry.safety_stock ?? null;
        const movable =
          entry.movable_stock !== undefined && entry.movable_stock !== null
            ? entry.movable_stock
            : closing !== null && safety !== null
              ? closing - safety
              : null;
        current.last_closing = closing;
        current.last_safety_stock = safety;
        current.last_movable_stock = movable;
      }
    });

    summary.channels[channel.channel] = current;
    rows.set(channel.sku_code, summary);
  });

  return Array.from(rows.values());
}
