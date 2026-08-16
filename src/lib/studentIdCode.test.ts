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
});
