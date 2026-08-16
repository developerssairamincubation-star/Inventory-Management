// Decodes the COE student ID code scheme:
//   [3-letter college code][2-digit join year][2-letter dept code][3-digit serial]
// e.g. "sit21cs025" -> Sri Sai Ram Institute Of Technology, joined 2021,
// dept code CS, serial 025. A lateral-entry student (transferred in
// directly to year 2, e.g. via diploma) carries an "L" right after the
// college code instead, and their serial isn't always zero-padded to 3
// digits (smaller batch) — e.g. "sitl21cs25" or "SECL21CS025". Pure parsing
// — no DB lookup here; department resolution (dept code -> department_id)
// happens in the caller (src/app/api/students/decode/route.ts), since that
// needs the DB.
//
// Typed and scanned the same way: a barcode scanner just types characters
// (+ Enter) into whatever input is focused, so this has no scanner-specific
// logic — callers trigger decode on Enter or once the input reaches the
// expected length.

export const COLLEGE_CODES: Record<string, string> = {
  sit: "Sri Sai Ram Institute Of Technology",
  sec: "Sri Sai Ram Engineering College",
  // extend here as more colleges are added
};

export type DecodedStudentId = {
  collegeCode: string;
  collegeName: string | null;
  joinYear: number; // full 4-digit, e.g. 2021
  deptCode: string; // 2-letter, uppercased
  serial: string; // 3-digit for regular entries, variable-length for lateral entries
  yearOfStudy: number | "Graduated";
  isLateralEntry: boolean;
};

const STUDENT_ID_CODE_PATTERN = /^([a-z]{3})(\d{2})([a-z]{2})(\d{3})$/i;
// Lateral-entry batches are smaller than the regular intake, so in practice
// their serials aren't always zero-padded to 3 digits (e.g. "18" rather
// than "018") — accept any run of digits here rather than requiring
// exactly 3 like the regular pattern does. No ambiguity risk: college code,
// the "l" marker, join year, and dept code are all fixed-width, so whatever
// digits remain at the end can only be the serial.
const LATERAL_STUDENT_ID_CODE_PATTERN = /^([a-z]{3})l(\d{2})([a-z]{2})(\d+)$/i;

// 4-year program assumed for the year-of-study calculation — revisit if any
// department code needs a different program length.
const PROGRAM_LENGTH_YEARS = 4;

// Canonical storage form — lowercase, trimmed. Every write path (lending
// creation, students CRUD, bulk upload) must normalize through this before
// touching students.student_id_code, so lookups stay consistent regardless
// of how the ID was typed/scanned.
export function normalizeStudentIdCode(rawCode: string): string {
  return rawCode.trim().toLowerCase();
}

export function decodeStudentIdCode(rawCode: string): DecodedStudentId | null {
  const code = normalizeStudentIdCode(rawCode);
  const regularMatch = STUDENT_ID_CODE_PATTERN.exec(code);
  const lateralMatch = regularMatch ? null : LATERAL_STUDENT_ID_CODE_PATTERN.exec(code);
  const match = regularMatch ?? lateralMatch;
  if (!match) return null;

  const isLateralEntry = !!lateralMatch;
  const [, collegeCode, yearDigits, deptCode, serial] = match;
  const joinYear = 2000 + Number(yearDigits);
  const currentYear = new Date().getFullYear();
  const yearsSinceJoining = currentYear - joinYear + 1;
  // Lateral entry students join directly into year 2 (having transferred
  // in, e.g. via diploma), skipping year 1 — one year further along the
  // program than their join year alone would suggest for a regular entry.
  const rawYear = yearsSinceJoining + (isLateralEntry ? 1 : 0);
  const yearOfStudy: number | "Graduated" =
    rawYear > PROGRAM_LENGTH_YEARS ? "Graduated" : rawYear;

  return {
    collegeCode,
    collegeName: COLLEGE_CODES[collegeCode] ?? null,
    joinYear,
    deptCode: deptCode.toUpperCase(),
    serial,
    yearOfStudy,
    isLateralEntry,
  };
}
