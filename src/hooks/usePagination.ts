"use client";

import { useMemo, useState } from "react";

export interface UsePaginationOptions {
  /** Rows per page. Defaults to 50 per the COE inventory pagination spec. */
  pageSize?: number;
}

export interface UsePaginationResult<T> {
  page: number;
  setPage: (page: number) => void;
  totalPages: number;
  /** The real rows for the current page (no padding). */
  pageRows: T[];
  /**
   * pageRows padded with `null` up to `pageSize` (when not showing all), so
   * a table always renders a fixed number of row-slots regardless of how
   * many real rows are on the current page.
   */
  padRows: (T | null)[];
  showAll: boolean;
  setShowAll: (showAll: boolean) => void;
  /** 0-indexed start/end of the current page's slice, for "Showing X-Y of Z" labels. */
  startIdx: number;
  endIdx: number;
  total: number;
}

export function usePagination<T>(rows: T[], options: UsePaginationOptions = {}): UsePaginationResult<T> {
  const pageSize = options.pageSize ?? 50;
  const [pageState, setPageState] = useState(1);
  const [showAll, setShowAll] = useState(false);

  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const page = Math.min(pageState, totalPages);

  const startIdx = (page - 1) * pageSize;
  const endIdx = startIdx + pageSize;

  const pageRows = useMemo(() => (showAll ? rows : rows.slice(startIdx, endIdx)), [rows, showAll, startIdx, endIdx]);

  const padRows = useMemo(() => {
    if (showAll) return pageRows;
    const padding = Math.max(0, pageSize - pageRows.length);
    return padding === 0 ? pageRows : [...pageRows, ...Array<null>(padding).fill(null)];
  }, [pageRows, showAll, pageSize]);

  const setPage = (p: number) => setPageState(Math.max(1, Math.min(totalPages, p)));

  return { page, setPage, totalPages, pageRows, padRows, showAll, setShowAll, startIdx, endIdx, total: rows.length };
}
