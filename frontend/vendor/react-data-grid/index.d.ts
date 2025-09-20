import type { CSSProperties, MouseEvent } from "react";

export interface Column<RowType> {
  key: string;
  name: string;
  width?: number;
  frozen?: boolean;
  headerCellClass?: string;
  className?: string | ((row: RowType) => string | undefined);
  renderCell?: (props: RenderCellProps<RowType>) => React.ReactNode;
  renderEditCell?: (props: RenderEditCellProps<RowType>) => React.ReactNode;
  editorOptions?: {
    editOnClick?: boolean;
  };
  setHeaderRef?: (element: HTMLDivElement | null) => void;
}

export interface RenderCellProps<RowType> {
  row: RowType;
  column: Column<RowType>;
}

export interface RenderEditCellProps<RowType> {
  row: RowType;
  column: Column<RowType>;
  onRowChange: (row: RowType, commit?: boolean) => void;
  onClose: (commit: boolean) => void;
}

export interface RowsChangeData<RowType> {
  column: Column<RowType>;
  indexes: number[];
}

export interface CellClickArgs<RowType> {
  row: RowType;
  column: Column<RowType>;
  rowIdx: number;
  columnIdx: number;
  event: MouseEvent<HTMLDivElement>;
}

export interface DataGridProps<RowType> {
  columns: readonly Column<RowType>[];
  rows: readonly RowType[];
  rowKeyGetter?: (row: RowType) => string | number;
  onRowsChange?: (rows: RowType[], data: RowsChangeData<RowType>) => void;
  onCellClick?: (args: CellClickArgs<RowType>) => void;
  style?: CSSProperties;
  className?: string;
  defaultColumnOptions?: {
    width?: number;
  };
  viewportRef?: React.Ref<HTMLDivElement>;
  rowClassName?: (row: RowType, rowIdx: number) => string | undefined;
}

export default function DataGrid<RowType>(props: DataGridProps<RowType>): JSX.Element;
export { DataGrid };
