import { UseQueryResult } from "@tanstack/react-query";

import { Session } from "../types";

interface PSIFilterPanelProps {
  sessionId: string;
  availableSessions: Session[];
  onSessionChange: (value: string) => void;
  sessionsQuery: UseQueryResult<Session[], unknown>;
  skuCode: string;
  onSkuCodeChange: (value: string) => void;
  warehouseName: string;
  onWarehouseNameChange: (value: string) => void;
  channel: string;
  onChannelChange: (value: string) => void;
  getErrorMessage: (error: unknown, fallback: string) => string;
}

function PSIFilterPanel({
  sessionId,
  availableSessions,
  onSessionChange,
  sessionsQuery,
  skuCode,
  onSkuCodeChange,
  warehouseName,
  onWarehouseNameChange,
  channel,
  onChannelChange,
  getErrorMessage,
}: PSIFilterPanelProps) {
  return (
    <div className="psi-panel psi-filter-panel">
      <h3>フィルタ</h3>
      <div className="psi-filter-grid">
        <label>
          Session
          <select
            value={sessionId}
            onChange={(event) => onSessionChange(event.target.value)}
            disabled={sessionsQuery.isLoading}
          >
            <option value="" disabled>
              Select a session
            </option>
            {availableSessions.map((session) => (
              <option key={session.id} value={session.id}>
                {session.title}
              </option>
            ))}
          </select>
        </label>
        <label>
          SKU Code
          <input
            type="text"
            value={skuCode}
            onChange={(event) => onSkuCodeChange(event.target.value)}
            placeholder="Optional"
          />
        </label>
        <label>
          Warehouse
          <input
            type="text"
            value={warehouseName}
            onChange={(event) => onWarehouseNameChange(event.target.value)}
            placeholder="Optional"
          />
        </label>
        <label>
          Channel
          <input
            type="text"
            value={channel}
            onChange={(event) => onChannelChange(event.target.value)}
            placeholder="Optional"
          />
        </label>
      </div>
      {sessionsQuery.isLoading && <p>Loading sessions...</p>}
      {sessionsQuery.isError && (
        <p className="error">{getErrorMessage(sessionsQuery.error, "Unable to load sessions.")}</p>
      )}
    </div>
  );
}

export default PSIFilterPanel;
