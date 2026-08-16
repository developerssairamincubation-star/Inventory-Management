import { describe, it, expect } from "vitest";
import { decodeStudentIdCode, COLLEGE_CODES } from "./studentIdCode";

const yy = (year: number) => String(year % 100).padStart(2, "0");

describe("decodeStudentIdCode", () => {
  it("decodes a valid code with a known college", () => {
    const decoded = decodeStudentIdCode("sit21cs025");
    expect(decoded).not.toBeNull();
    expect(decoded?.collegeCode).toBe("sit");
    expect(decoded?.collegeName).toBe(COLLEGE_CODES.sit);
    expect(decoded?.joinYear).toBe(2021);
    expect(decoded?.deptCode).toBe("CS");
    expect(decoded?.serial).toBe("025");
  });

  it("decodes an unknown college code, with a null college name", () => {
    const decoded = decodeStudentIdCode("xyz21cs025");
    expect(decoded).not.toBeNull();
    expect(decoded?.collegeCode).toBe("xyz");
    expect(decoded?.collegeName).toBeNull();
  });

  it("is case-insensitive and trims whitespace", () => {
    const upper = decodeStudentIdCode("  SEC22CS123  ");
    const lower = decodeStudentIdCode("sec22cs123");
    expect(upper).toEqual(lower);
    expect(upper?.deptCode).toBe("CS");
  });

  it("returns null for malformed input", () => {
    expect(decodeStudentIdCode("sit21cs02")).toBeNull(); // too short
    expect(decodeStudentIdCode("sit21cs0255")).toBeNull(); // too long
    expect(decodeStudentIdCode("si21cs025")).toBeNull(); // college code not 3 letters
    expect(decodeStudentIdCode("sit2c1s025")).toBeNull(); // year not 2 digits
    expect(decodeStudentIdCode("")).toBeNull();
  });

  it("computes year 1 for a student who joined this year", () => {
    const currentYear = new Date().getFullYear();
    const decoded = decodeStudentIdCode(`sit${yy(currentYear)}cs001`);
    expect(decoded?.yearOfStudy).toBe(1);
  });

  it("computes year 4 for a student in their final year of a 4-year program", () => {
    const currentYear = new Date().getFullYear();
    const decoded = decodeStudentIdCode(`sit${yy(currentYear - 3)}cs001`);
    expect(decoded?.yearOfStudy).toBe(4);
  });

  it("labels a student past year 4 as Graduated", () => {
    const currentYear = new Date().getFullYear();
    const decoded = decodeStudentIdCode(`sit${yy(currentYear - 4)}cs001`);
    expect(decoded?.yearOfStudy).toBe("Graduated");
  });

  it("decodes a lateral-entry code (L after the college code)", () => {
    const decoded = decodeStudentIdCode("secl21cs025");
    expect(decoded).not.toBeNull();
    expect(decoded?.collegeCode).toBe("sec");
    expect(decoded?.collegeName).toBe(COLLEGE_CODES.sec);
    expect(decoded?.joinYear).toBe(2021);
    expect(decoded?.deptCode).toBe("CS");
    expect(decoded?.serial).toBe("025");
    expect(decoded?.isLateralEntry).toBe(true);
  });

  it("decodes a lateral-entry code with a non-zero-padded 2-digit serial", () => {
    // Real-world example that was failing: "SECL26EC18" — serial "18", not
    // zero-padded to "018" like the regular-entry format uses.
    const decoded = decodeStudentIdCode("SECL26EC18");
    expect(decoded).not.toBeNull();
    expect(decoded?.collegeCode).toBe("sec");
    expect(decoded?.deptCode).toBe("EC");
    expect(decoded?.serial).toBe("18");
    expect(decoded?.isLateralEntry).toBe(true);
  });

  it("still rejects a malformed regular (non-lateral) code with a short serial", () => {
    // Serial-length flexibility only applies to lateral-entry (L) codes —
    // a regular code with a 2-digit serial is still invalid.
    expect(decodeStudentIdCode("sit21cs02")).toBeNull();
  });

  it("is case-insensitive for the lateral-entry L", () => {
    const upper = decodeStudentIdCode("SITL21CS025");
    const lower = decodeStudentIdCode("sitl21cs025");
    expect(upper).toEqual(lower);
    expect(upper?.isLateralEntry).toBe(true);
  });

  it("marks a regular (non-lateral) code as isLateralEntry: false", () => {
    const decoded = decodeStudentIdCode("sit21cs025");
    expect(decoded?.isLateralEntry).toBe(false);
  });

  it("puts a lateral-entry student one year ahead of a regular student who joined the same year", () => {
    const currentYear = new Date().getFullYear();
    const regular = decodeStudentIdCode(`sit${yy(currentYear)}cs001`);
    const lateral = decodeStudentIdCode(`sitl${yy(currentYear)}cs001`);
    expect(regular?.yearOfStudy).toBe(1);
    expect(lateral?.yearOfStudy).toBe(2);
  });

  it("labels a lateral-entry student past year 4 as Graduated one year earlier than a regular student", () => {
    const currentYear = new Date().getFullYear();
    // A regular student who joined 3 years ago is in year 4 (final year).
    expect(decodeStudentIdCode(`sit${yy(currentYear - 3)}cs001`)?.yearOfStudy).toBe(4);
    // A lateral-entry student who joined 3 years ago is already past year 4.
    expect(decodeStudentIdCode(`sitl${yy(currentYear - 3)}cs001`)?.yearOfStudy).toBe("Graduated");
  });
});
