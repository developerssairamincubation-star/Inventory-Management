// Client-side date-range filter helpers shared by the Returnable and
// Consumable pages' From/To + "This Week / This Month / Last Month / This
// Year" filter.

export function toISODate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export type DatePreset = "thisWeek" | "thisMonth" | "lastMonth" | "thisYear";

export function presetRange(preset: DatePreset): { from: string; to: string } {
  const now = new Date();
  if (preset === "thisWeek") {
    // Monday through Sunday of the week `now` falls in — the full week, not
    // week-to-date, so the range covers records dated later this week (a
    // returnable due Friday is still "this week" when you look on Tuesday).
    //
    // getDay() is 0 for Sunday, so the offset back to Monday is (day + 6) % 7:
    // Sunday counts as 6 days after Monday rather than 1 day before it, which
    // is what a plain `day - 1` would give.
    const daysSinceMonday = (now.getDay() + 6) % 7;
    const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - daysSinceMonday);
    const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
    return { from: toISODate(monday), to: toISODate(sunday) };
  }
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
