import { useEffect, useMemo, useRef, useState } from "react";

function clsx(...values) {
  return values.filter(Boolean).join(" ");
}

function ensureRef(ref, value) {
  if (typeof ref === "function") {
    ref(value);
    return () => ref(null);
  }
  if (ref && "current" in ref) {
    ref.current = value;
    return () => {
      if (ref.current === value) {
        ref.current = null;
      }
    };
  }
  return () => {};
}

function DataGrid({
  columns,
  rows,
  rowKeyGetter,
  onRowsChange,
  onCellClick,
  style,
  className,
  defaultColumnOptions,
  viewportRef,
  rowClassName,
}) {
  const columnWidth = defaultColumnOptions?.width ?? 140;
  const columnsWithWidth = useMemo(
    () =>
      columns.map((column) => ({
        ...column,
        width: column.width ?? columnWidth,
      })),
    [columns, columnWidth]
  );

  const templateColumns = useMemo(
    () => columnsWithWidth.map((column) => `${column.width}px`).join(" "),
    [columnsWithWidth]
  );

  const frozenOffsets = useMemo(() => {
    let offset = 0;
    return columnsWithWidth.map((column) => {
      if (!column.frozen) {
        return null;
      }
      const current = offset;
      offset += column.width;
      return current;
    });
  }, [columnsWithWidth]);

  const [internalRows, setInternalRows] = useState(rows);
  const [editing, setEditing] = useState(null);
  const headerInnerRef = useRef(null);
  const bodyRef = useRef(null);

  useEffect(() => {
    setInternalRows(rows);
    setEditing(null);
  }, [rows]);

  useEffect(() => {
    if (!viewportRef) {
      return undefined;
    }
    return ensureRef(viewportRef, bodyRef.current);
  }, [viewportRef]);

  useEffect(() => {
    const body = bodyRef.current;
    const headerInner = headerInnerRef.current;
    if (!body || !headerInner) {
      return undefined;
    }

    const handleScroll = () => {
      headerInner.style.transform = `translateX(${-body.scrollLeft}px)`;
    };

    body.addEventListener("scroll", handleScroll, { passive: true });
    handleScroll();

    return () => {
      body.removeEventListener("scroll", handleScroll);
    };
  }, [templateColumns]);

  const startEditing = (rowIdx, column, columnIdx) => {
    if (!column.renderEditCell) {
      return;
    }
    setEditing({
      rowIdx,
      columnKey: column.key,
      column,
      columnIdx,
      draftRow: { ...internalRows[rowIdx] },
    });
  };

  const commitRow = (updatedRow, column, rowIdx) => {
    setInternalRows((previousRows) => {
      const nextRows = previousRows.map((row, index) => (index === rowIdx ? updatedRow : row));
      if (onRowsChange) {
        onRowsChange(nextRows, { column, indexes: [rowIdx] });
      }
      return nextRows;
    });
    setEditing(null);
  };

  const handleRowChange = (updatedRow, commit = false) => {
    setEditing((previous) => {
      if (!previous) {
        return previous;
      }
      const next = { ...previous, draftRow: updatedRow };
      if (commit) {
        commitRow(updatedRow, previous.column, previous.rowIdx);
      }
      return next;
    });
  };

  const handleClose = (commit) => {
    setEditing((previous) => {
      if (!previous) {
        return previous;
      }
      if (commit) {
        commitRow(previous.draftRow, previous.column, previous.rowIdx);
        return null;
      }
      return null;
    });
  };

  const renderCellContent = (row, column, rowIdx, columnIdx) => {
    const isEditing =
      editing &&
      editing.rowIdx === rowIdx &&
      editing.columnKey === column.key &&
      column.renderEditCell;

    if (isEditing) {
      return column.renderEditCell({
        row: editing.draftRow,
        column,
        onRowChange: handleRowChange,
        onClose: handleClose,
      });
    }

    if (column.renderCell) {
      return column.renderCell({ row, column });
    }

    const value = row[column.key];
    return value == null ? "" : String(value);
  };

  const rowsToRender = internalRows;

  return (
    <div className={clsx("rdg", className)} style={style}>
      <div className="rdg-header">
        <div className="rdg-header-row" ref={headerInnerRef} style={{ gridTemplateColumns: templateColumns }}>
          {columnsWithWidth.map((column, columnIdx) => {
            const frozenOffset = frozenOffsets[columnIdx];
            return (
              <div
                key={column.key}
                data-column-key={column.key}
                className={clsx("rdg-header-cell", column.headerCellClass)}
                style={{
                  width: column.width,
                  minWidth: column.width,
                  maxWidth: column.width,
                  ...(column.frozen
                    ? {
                        position: "sticky",
                        left: frozenOffset ?? 0,
                        zIndex: 3,
                      }
                    : null),
                }}
                ref={column.setHeaderRef || null}
              >
                {column.name}
              </div>
            );
          })}
        </div>
      </div>
      <div className="rdg-body" ref={bodyRef}>
        {rowsToRender.map((row, rowIdx) => {
          const rowKey = rowKeyGetter ? rowKeyGetter(row) : rowIdx;
          const extraRowClassName = rowClassName ? rowClassName(row, rowIdx) : undefined;
          return (
            <div
              key={rowKey}
              className={clsx("rdg-row", extraRowClassName)}
              style={{ gridTemplateColumns: templateColumns }}
            >
              {columnsWithWidth.map((column, columnIdx) => {
                const frozenOffset = frozenOffsets[columnIdx];
                const cellClass =
                  typeof column.className === "function"
                    ? column.className(row)
                    : column.className;
                const isEditable = Boolean(column.renderEditCell);
                const editOnClick = Boolean(column.editorOptions?.editOnClick);

                const handleClick = (event) => {
                  if (onCellClick) {
                    onCellClick({
                      row,
                      column,
                      rowIdx,
                      columnIdx,
                      event,
                    });
                  }
                  if (isEditable && editOnClick) {
                    event.preventDefault();
                    startEditing(rowIdx, column, columnIdx);
                  }
                };

                const handleDoubleClick = () => {
                  if (isEditable) {
                    startEditing(rowIdx, column, columnIdx);
                  }
                };

                return (
                  <div
                    key={column.key}
                    data-column-key={column.key}
                    className={clsx("rdg-cell", cellClass)}
                    style={{
                      width: column.width,
                      minWidth: column.width,
                      maxWidth: column.width,
                      ...(column.frozen
                        ? {
                            position: "sticky",
                            left: frozenOffset ?? 0,
                            zIndex: 2,
                          }
                        : null),
                    }}
                    onClick={handleClick}
                    onDoubleClick={handleDoubleClick}
                  >
                    {renderCellContent(row, column, rowIdx, columnIdx)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default DataGrid;
export { DataGrid };
