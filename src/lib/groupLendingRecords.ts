// Groups the flat per-item rows returned by GET /api/lending (one row per
// lending_item, see route.ts) into one row per (student, calendar day) —
// two lending_order records created for the same student on the same date
// (e.g. a mixed-item-type submission that had to split into multiple
// orders, or an operator entry logged twice) should read as a single entry
// on the Entry/Returnable/Consumable pages instead of one row per item.

// Local calendar day, matching each page's own formatDate() (which also
// builds DD/MM/YYYY from local getDate/getMonth/getFullYear) — grouping by
// UTC day here would occasionally disagree with what's actually displayed.
export function localDayKey(dateString: string | null | undefined): string {
  if (!dateString) return "unknown";
  const d = new Date(dateString);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

export type LendingGroup<T> = {
  key: string;
  date: string;
  records: T[];
};

export function groupByStudentAndDate<T extends { student_id_code: string | null; borrower_name: string; lending_date: string }>(
  records: T[]
): LendingGroup<T>[] {
  const groups = new Map<string, LendingGroup<T>>();
  const order: string[] = [];

  for (const r of records) {
    const studentKey = r.student_id_code || `name:${r.borrower_name}`;
    const key = `${studentKey}__${localDayKey(r.lending_date)}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, date: r.lending_date, records: [] };
      groups.set(key, group);
      order.push(key);
    }
    group.records.push(r);
  }

  return order.map((k) => groups.get(k)!);
}

// Shared by the per-item row and a grouped summary row's aggregate counts
// (Entry/Returnable pages) — same math, just summed across a group's
// records in the latter case.
export function computeItemCounts(record: { original_quantity: number; quantity: number; damaged_quantity: number; lost_quantity: number; status: string }) {
  const FULLY_RETURNED_STATUSES = ["RETURNED", "RETURNED_DAMAGED", "RETURNED_LOST"];
  const borrowed = record.original_quantity ?? record.quantity;
  const damaged = record.damaged_quantity ?? 0;
  const lost = record.lost_quantity ?? 0;
  const currentQty = record.quantity;
  const isFullyReturned = FULLY_RETURNED_STATUSES.includes(record.status);
  const retd = isFullyReturned ? Math.max(0, borrowed - damaged - lost) : Math.max(0, borrowed - currentQty - damaged - lost);
  const balance = isFullyReturned ? 0 : currentQty;
  return { borrowed, retd, damaged, lost, balance };
}
