import { memo, useMemo } from "react";

import { ChannelAgg, SummaryRow } from "../utils/psiSummary";

type Props = {
  rows: SummaryRow[];
  onSelectSku: (sku: string | null) => void;
  selectedSku?: string | null;
  channelOrder?: string[];
};

const numberFormatter = new Intl.NumberFormat("ja-JP", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

const formatValue = (value: number | null | undefined) => {
  if (value === null || value === undefined) {
    return "—";
  }
  return numberFormatter.format(value);
};

const metricLabels: { key: keyof ChannelAgg; label: string }[] = [
  { key: "inbound_sum", label: "Inbound" },
  { key: "outbound_sum", label: "Outbound" },
  { key: "last_closing", label: "Stock Closing" },
];

const PSISummaryTable = memo(function PSISummaryTable({
  rows,
  onSelectSku,
  selectedSku,
  channelOrder,
}: Props) {
  const orderedChannels = useMemo(() => {
    const unique = new Set<string>();
    rows.forEach((row) => {
      Object.keys(row.channels).forEach((channel) => {
        unique.add(channel);
      });
    });

    const channels = Array.from(unique);

    if (!channelOrder || !channelOrder.length) {
      return channels.sort((a, b) => a.localeCompare(b));
    }

    const priority = new Map(channelOrder.map((channel, index) => [channel, index] as const));

    return channels.sort((a, b) => {
      const aPriority = priority.has(a) ? priority.get(a)! : Number.POSITIVE_INFINITY;
      const bPriority = priority.has(b) ? priority.get(b)! : Number.POSITIVE_INFINITY;
      if (aPriority !== bPriority) {
        return aPriority - bPriority;
      }
      return a.localeCompare(b);
    });
  }, [rows, channelOrder]);

  if (!rows.length) {
    return null;
  }

  return (
    <table className="psi-summary-table">
      <thead>
        <tr>
          <th scope="col">SKU</th>
          <th scope="col">Metric</th>
          {orderedChannels.map((channel) => (
            <th key={channel} scope="col" className="numeric">
              {channel}
            </th>
          ))}
        </tr>
      </thead>
      {rows.map((row) => {
        const isSelected = row.sku_code === selectedSku;
        const handleSelect = () => {
          onSelectSku(isSelected ? null : row.sku_code);
        };

        return (
          <tbody
            key={row.sku_code}
            className={`psi-summary-group${isSelected ? " is-selected" : ""}`}
          >
            {metricLabels.map((metric, index) => {
              const positionClass =
                index === 0
                  ? " group-start"
                  : index === metricLabels.length - 1
                  ? " group-end"
                  : " group-middle";

              return (
                <tr
                  key={`${row.sku_code}-${metric.key}`}
                  className={`psi-summary-row${positionClass}${isSelected ? " is-selected" : ""}`}
                  onClick={handleSelect}
                  role="button"
                  tabIndex={index === 0 ? 0 : -1}
                  aria-pressed={isSelected}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      handleSelect();
                    }
                  }}
                >
                  {index === 0 && (
                    <th scope="rowgroup" rowSpan={metricLabels.length} className="psi-summary-sku">
                      <div className="psi-summary-sku-code">{row.sku_code}</div>
                      {row.sku_name && <div className="psi-summary-sku-name">{row.sku_name}</div>}
                    </th>
                  )}
                  <th scope="row">{metric.label}</th>
                  {orderedChannels.map((channel) => {
                    const channelAgg = row.channels[channel];
                    const value = channelAgg ? channelAgg[metric.key] : null;
                    return (
                      <td key={`${row.sku_code}-${metric.key}-${channel}`} className="numeric">
                        {formatValue(value)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        );
      })}
    </table>
  );
});

export default PSISummaryTable;
