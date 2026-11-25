"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface Column<T> {
  key: string;
  header: React.ReactNode;
  /** Value to sort on; a column without it is not sortable. */
  sort?: (row: T) => number | string | null;
  render: (row: T) => React.ReactNode;
  align?: "left" | "right";
  className?: string;
}

/** Rows ordered by one column; empty values (null) always last. Stable for equal values. */
export function sortRows<T>(
  rows: T[],
  columns: Column<T>[],
  sort: { key: string; dir: "asc" | "desc" } | null,
): T[] {
  const col = sort ? columns.find((c) => c.key === sort.key) : undefined;
  if (!sort || !col?.sort) return rows;
  const get = col.sort;
  const dir = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = get(a);
    const y = get(b);
    if (x === y) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return (
      (typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y), "id-ID")) * dir
    );
  });
}

/**
 * Every list in the app (user rule 2026-11-18): 10 rows per page with previous/next, and a click
 * on a column header sorts by it (again to reverse). With `rank`, a "No" column numbers the rows
 * in the current order across pages.
 */
export function DataTable<T>({
  rows,
  columns,
  rowKey,
  pageSize = 10,
  initialSort,
  rank = false,
  empty = "Tidak ada data.",
  className,
  renderRow,
}: {
  rows: T[];
  columns: Column<T>[];
  rowKey: (row: T) => string;
  pageSize?: number;
  initialSort?: { key: string; dir: "asc" | "desc" };
  rank?: boolean;
  empty?: React.ReactNode;
  className?: string;
  /** A row with its own state (forms): the columns then only give headers and sorting. */
  renderRow?: (row: T) => React.ReactNode;
}) {
  const [sort, setSort] = useState(initialSort ?? null);
  const [page, setPage] = useState(0);

  const sorted = useMemo(
    () => sortRows(rows, columns, sort),
    [rows, columns, sort],
  );

  const pages = Math.max(1, Math.ceil(sorted.length / pageSize));
  // A new filter or period can leave fewer pages than the one shown.
  const current = Math.min(page, pages - 1);
  const shown = sorted.slice(current * pageSize, current * pageSize + pageSize);

  const toggle = (key: string) => {
    setSort((s) =>
      s?.key === key
        ? { key, dir: s.dir === "desc" ? "asc" : "desc" }
        : { key, dir: "desc" },
    );
    setPage(0);
  };

  if (rows.length === 0)
    return <p className="py-6 text-center text-base text-navy-500">{empty}</p>;

  return (
    <div className={className}>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-base">
          <thead>
            <tr>
              {rank && <th className="w-12 text-right">No</th>}
              {columns.map((c) => (
                <th
                  key={c.key}
                  className={cn(
                    c.align === "right" && "text-right",
                    c.className,
                  )}
                  aria-sort={
                    sort?.key === c.key
                      ? sort.dir === "asc"
                        ? "ascending"
                        : "descending"
                      : undefined
                  }
                >
                  {c.sort ? (
                    <button
                      type="button"
                      onClick={() => toggle(c.key)}
                      className={cn(
                        "inline-flex items-center gap-1 font-[inherit] uppercase",
                        c.align === "right" && "flex-row-reverse",
                      )}
                    >
                      {c.header}
                      {sort?.key === c.key ? (
                        sort.dir === "desc" ? (
                          <ArrowDown className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowUp className="h-3.5 w-3.5" />
                        )
                      ) : (
                        <span className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : (
                    c.header
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((row, i) =>
              renderRow ? (
                <Fragment key={rowKey(row)}>{renderRow(row)}</Fragment>
              ) : (
                <tr key={rowKey(row)}>
                  {rank && (
                    <td className="text-right tabular-nums text-navy-500">
                      {current * pageSize + i + 1}
                    </td>
                  )}
                  {columns.map((c) => (
                    <td
                      key={c.key}
                      className={cn(
                        c.align === "right" && "text-right tabular-nums",
                        c.className,
                      )}
                    >
                      {c.render(row)}
                    </td>
                  ))}
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between gap-3 text-sm text-navy-600">
          <span className="tabular-nums">
            {current * pageSize + 1}–
            {Math.min(sorted.length, (current + 1) * pageSize)} dari{" "}
            {sorted.length}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(current - 1)}
              disabled={current === 0}
              className="skeuo-pill-light inline-flex min-h-9 items-center gap-1 rounded-full px-3 font-semibold disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" /> Sebelumnya
            </button>
            <span className="tabular-nums">
              {current + 1} / {pages}
            </span>
            <button
              type="button"
              onClick={() => setPage(current + 1)}
              disabled={current >= pages - 1}
              className="skeuo-pill-light inline-flex min-h-9 items-center gap-1 rounded-full px-3 font-semibold disabled:opacity-40"
            >
              Berikutnya <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
