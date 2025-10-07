import type { PsiRow } from "../types";
import { formatMetricValue, safeNumber } from "../utils";

interface OriginViewProps {
  rows: PsiRow[];
}

export default function OriginView({ rows }: OriginViewProps) {
  return (
    <div className="table-wrapper">
      <table className="data-table">
        <thead>
          <tr>
            <th>SKU</th>
            <th>SKU Name</th>
            <th>Warehouse</th>
            <th>Channel</th>
            <th>Stock @ Start</th>
            <th>Inbound</th>
            <th>Outbound</th>
            <th>Stock Closing</th>
            <th>Std Stock</th>
            <th>Gap</th>
            <th>Move</th>
            <th>Stock Final</th>
            <th>Gap After</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const stockStartValue = safeNumber(row.stockStart);
            const inboundValue = safeNumber(row.inbound);
            const outboundValue = safeNumber(row.outbound);
            const moveValue = safeNumber(row.move);
            const stdStockValue = safeNumber(row.stdStock);
            const stockClosingValue =
              typeof row.stockClosing === "number" && Number.isFinite(row.stockClosing)
                ? row.stockClosing
                : stockStartValue + inboundValue - outboundValue;
            const stockFinalValue =
              typeof row.stockFinal === "number" && Number.isFinite(row.stockFinal)
                ? row.stockFinal
                : stockClosingValue + moveValue;
            const gapValue = row.gap ?? stockFinalValue - stdStockValue;
            const gapAfter = row.gapAfter ?? gapValue + moveValue;
            return (
              <tr key={`${row.sku}|${row.warehouse}|${row.channel}`}>
                <td>{row.sku}</td>
                <td>{row.skuName ?? "-"}</td>
                <td>{row.warehouse}</td>
                <td>{row.channel}</td>
                <td>{formatMetricValue(row.stockStart)}</td>
                <td>{formatMetricValue(row.inbound)}</td>
                <td>{formatMetricValue(row.outbound)}</td>
                <td>{formatMetricValue(row.stockClosing)}</td>
                <td>{formatMetricValue(row.stdStock)}</td>
                <td>{formatMetricValue(gapValue)}</td>
                <td>{formatMetricValue(row.move)}</td>
                <td>{formatMetricValue(stockFinalValue)}</td>
                <td style={{ color: gapAfter < 0 ? "#c0392b" : undefined }}>
                  {formatMetricValue(gapAfter)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
