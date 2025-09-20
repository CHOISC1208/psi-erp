declare module "react-data-grid" {
  export type {
    Column,
    RenderCellProps,
    RenderEditCellProps,
    RowsChangeData,
    CellClickArgs,
    DataGridProps,
  } from "../vendor/react-data-grid/index.d.ts";

  const DataGrid: typeof import("../vendor/react-data-grid/index.d.ts")['default'];
  export default DataGrid;
}
