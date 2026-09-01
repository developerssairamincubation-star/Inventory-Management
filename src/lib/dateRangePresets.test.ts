import { describe, it, expect, afterEach, vi } from "vitest";
import { presetRange, inDateRange } from "./dateRangePresets";

// Local noon, so a range built from these dates can't be shifted into the
// neighbouring day by the machine's timezone offset.
const at = (iso: string) => new Date(`${iso}T12:00:00`);

function freeze(iso: string) {
  vi.useFakeTimers();
  vi.setSystemTime(at(iso));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("presetRange('thisWeek')", () => {
  // 2026-08-31 is a Monday, so this block walks one full Mon–Sun week and
  // every day of it must resolve to the same range.
  const week = { from: "2026-08-31", to: "2026-09-06" };

  it.each([
    ["Monday", "2026-08-31"],
    ["Tuesday", "2026-09-01"],
    ["Wednesday", "2026-09-02"],
    ["Thursday", "2026-09-03"],
    ["Friday", "2026-09-04"],
    ["Saturday", "2026-09-05"],
    // The case a plain `getDay() - 1` gets wrong: getDay() is 0 on Sunday, so
    // it would roll the range forward to the *next* week instead of closing
    // the current one.
    ["Sunday", "2026-09-06"],
  ])("returns Monday–Sunday when today is %s", (_day, today) => {
    freeze(today);
    expect(presetRange("thisWeek")).toEqual(week);
  });

  it("spans the month boundary rather than clamping to the 1st", () => {
    freeze("2026-09-02");
    // August into September — the week is not truncated at the month edge the
    // way "This Month" deliberately is.
    expect(presetRange("thisWeek").from).toBe("2026-08-31");
  });

  it("spans a year boundary", () => {
    // Thursday 2026-12-31 sits in the week beginning Monday 2026-12-28.
    freeze("2026-12-31");
    expect(presetRange("thisWeek")).toEqual({ from: "2026-12-28", to: "2027-01-03" });
  });

  it("covers the whole week, not just week-to-date", () => {
    freeze("2026-09-01"); // Tuesday
    const { from, to } = presetRange("thisWeek");
    // A returnable due Friday is still "this week" when you look on Tuesday.
    expect(inDateRange("2026-09-04", from, to)).toBe(true);
    expect(inDateRange("2026-08-31", from, to)).toBe(true);
    expect(inDateRange("2026-09-06", from, to)).toBe(true);
    // ...and the days either side are not.
    expect(inDateRange("2026-08-30", from, to)).toBe(false);
    expect(inDateRange("2026-09-07", from, to)).toBe(false);
  });
});
