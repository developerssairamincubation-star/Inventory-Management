// Client-side date-range filter helpers shared by the Returnable and
// Consumable pages' From/To + "This Month / Last Month / This Year" filter.

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type DatePreset = "thisMonth" | "lastMonth" | "thisYear";

export function presetRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  if (preset === "thisMonth") {
    return { from: toISODate(new Date(now.getFullYear(), now.getMonth(), 1)), to: toISODate(now) };
  }
  if (preset === "lastMonth") {
    return {
      // Day 0 of the current month is the last day of the previous month.
      from: toISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
      to: toISODate(new Date(now.getFullYear(), now.getMonth(), 0)),
    };
  }
  return { from: toISODate(new Date(now.getFullYear(), 0, 1)), to: toISODate(now) };
}

// Inclusive [from, to] check against a record's ISO lending_date. Either
// bound may be "" (unbounded on that side).
export function inDateRange(dateStr: string | null, from: string, to: string): boolean {
  if (!from && !to) return true;
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (from && d < new Date(`${from}T00:00:00`)) return false;
  if (to && d > new Date(`${to}T23:59:59.999`)) return false;
  return true;
}
