// Decodes the COE student ID code scheme:
//   [3-letter college code][2-digit join year][2-letter dept code][3-digit serial]
// e.g. "sit21cs025" -> Sri Sai Ram Institute Of Technology, joined 2021,
// dept code CS, serial 025. Pure parsing — no DB lookup here; department
// resolution (dept code -> department_id) happens in the caller
// (src/app/api/students/decode/route.ts), since that needs the DB.
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
  serial: string; // 3-digit
  yearOfStudy: number | "Graduated";
};

const STUDENT_ID_CODE_PATTERN = /^([a-z]{3})(\d{2})([a-z]{2})(\d{3})$/i;

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
  const match = STUDENT_ID_CODE_PATTERN.exec(code);
  if (!match) return null;

  const [, collegeCode, yearDigits, deptCode, serial] = match;
  const joinYear = 2000 + Number(yearDigits);
  const currentYear = new Date().getFullYear();
  const yearsSinceJoining = currentYear - joinYear + 1;
  const yearOfStudy: number | "Graduated" =
    yearsSinceJoining > PROGRAM_LENGTH_YEARS ? "Graduated" : yearsSinceJoining;

  return {
    collegeCode,
    collegeName: COLLEGE_CODES[collegeCode] ?? null,
    joinYear,
    deptCode: deptCode.toUpperCase(),
    serial,
    yearOfStudy,
  };
}
