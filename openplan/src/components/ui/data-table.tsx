import * as React from "react";

import { cn } from "@/lib/utils";

export type DataTableColumn<T> = {
  id: string;
  header: React.ReactNode;
  cell: (row: T, index: number) => React.ReactNode;
  align?: "left" | "right" | "center";
  width?: string;
  srOnlyHeader?: boolean;
};

type DataTableProps<T> = {
  columns: ReadonlyArray<DataTableColumn<T>>;
  rows: ReadonlyArray<T>;
  getRowId: (row: T, index: number) => string;
  onRowSelect?: (row: T, index: number) => void;
  selectedRowId?: string | null;
  emptyState?: React.ReactNode;
  caption?: React.ReactNode;
  className?: string;
  density?: "comfortable" | "compact";
};

const alignClass = (align: DataTableColumn<unknown>["align"]) =>
  align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";

const densityClass = (density: DataTableProps<unknown>["density"]) =>
  density === "compact" ? "py-1.5 text-xs" : "py-2.5 text-sm";

export function DataTable<T>({
  columns,
  rows,
  getRowId,
  onRowSelect,
  selectedRowId,
  emptyState,
  caption,
  className,
  density = "comfortable",
}: DataTableProps<T>) {
  if (rows.length === 0 && emptyState) {
    return <div className={cn("data-table-empty", className)}>{emptyState}</div>;
  }

  return (
    <div className={cn("data-table-wrapper overflow-x-auto rounded-[14px] border border-border/60", className)}>
      <table className="data-table w-full border-collapse">
        {caption ? <caption className="sr-only">{caption}</caption> : null}
        <thead className="data-table-head bg-muted/40">
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  "data-table-header border-b border-border/60 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground",
                  alignClass(column.align)
                )}
              >
                {column.srOnlyHeader ? <span className="sr-only">{column.header}</span> : column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="data-table-body">
          {rows.map((row, index) => {
            const id = getRowId(row, index);
            const isSelected = selectedRowId === id;
            const isInteractive = Boolean(onRowSelect);
            return (
              <tr
                key={id}
                data-row-id={id}
                aria-selected={isInteractive ? isSelected : undefined}
                className={cn(
                  "data-table-row border-b border-border/40 last:border-b-0 transition-colors",
                  isInteractive && "cursor-pointer hover:bg-muted/40",
                  isSelected && "bg-sky-500/10"
                )}
                onClick={isInteractive ? () => onRowSelect?.(row, index) : undefined}
              >
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(
                      "data-table-cell px-3 align-middle text-foreground",
                      densityClass(density),
                      alignClass(column.align)
                    )}
                  >
                    {column.cell(row, index)}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
