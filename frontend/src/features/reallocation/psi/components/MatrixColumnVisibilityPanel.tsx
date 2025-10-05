import type { MatrixGroupMeta } from "../gridUtils";

interface MatrixColumnVisibilityPanelProps {
  groups: MatrixGroupMeta[];
  collapsedGroups: Set<string>;
  visibleColumns: Set<string>;
  onToggleGroupCollapse: (groupId: string) => void;
  onToggleGroupVisibility: (groupId: string, visible: boolean) => void;
  onToggleColumnVisibility: (columnId: string, visible: boolean) => void;
}

export function MatrixColumnVisibilityPanel({
  groups,
  collapsedGroups,
  visibleColumns,
  onToggleGroupCollapse,
  onToggleGroupVisibility,
  onToggleColumnVisibility,
}: MatrixColumnVisibilityPanelProps) {
  return (
    <div className="psi-matrix-column-panel" role="region" aria-label="列表示コントロール">
      <details open>
        <summary>列表示を調整</summary>
        <div className="psi-matrix-column-panel__content">
          {groups.map((group) => {
            const groupColumnIds = group.columns.map((column) => column.id);
            const visibleCount = groupColumnIds.reduce((count, columnId) => count + (visibleColumns.has(columnId) ? 1 : 0), 0);
            const isAllVisible = visibleCount === groupColumnIds.length;
            const isNoneVisible = visibleCount === 0;
            const groupCollapsed = collapsedGroups.has(group.id);

            return (
              <div key={group.id} className="psi-matrix-column-panel__group">
                <div className="psi-matrix-column-panel__group-header">
                  <div className="psi-matrix-column-panel__group-summary">
                    <button
                      type="button"
                      className="psi-matrix-column-panel__toggle"
                      onClick={() => onToggleGroupCollapse(group.id)}
                      aria-label={`${group.fullLabel} を${groupCollapsed ? "展開" : "折りたたみ"}`}
                    >
                      {groupCollapsed ? "▸" : "▾"}
                    </button>
                    <span title={group.fullLabel}>{group.shortLabel}</span>
                    <span className="psi-matrix-column-panel__count">
                      {visibleCount}/{groupColumnIds.length}
                    </span>
                  </div>
                  <div className="psi-matrix-column-panel__group-actions">
                    <label>
                      <input
                        type="checkbox"
                        checked={isAllVisible}
                        aria-checked={isAllVisible ? "true" : isNoneVisible ? "false" : "mixed"}
                        ref={(element) => {
                          if (element) {
                            element.indeterminate = !isAllVisible && !isNoneVisible;
                          }
                        }}
                        onChange={(event) => onToggleGroupVisibility(group.id, event.target.checked)}
                      />
                      全表示
                    </label>
                  </div>
                </div>
                {!groupCollapsed && (
                  <div className="psi-matrix-column-panel__channels">
                    {group.columns.map((column) => {
                      const isVisible = visibleColumns.has(column.id);
                      return (
                        <label key={column.id} title={column.tooltip} className="psi-matrix-column-panel__channel">
                          <input
                            type="checkbox"
                            checked={isVisible}
                            onChange={(event) => onToggleColumnVisibility(column.id, event.target.checked)}
                          />
                          <span>{column.shortLabel}</span>
                        </label>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </details>
    </div>
  );
}

export default MatrixColumnVisibilityPanel;
