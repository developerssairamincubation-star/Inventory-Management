import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "./passwords";

describe("passwords", () => {
  it("hashes a password and verifies the correct plaintext against it", async () => {
    const hash = await hashPassword("ChangeMe123!");
    expect(hash).not.toEqual("ChangeMe123!");
    await expect(verifyPassword("ChangeMe123!", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect plaintext", async () => {
    const hash = await hashPassword("ChangeMe123!");
    await expect(verifyPassword("WrongPassword", hash)).resolves.toBe(false);
  });

  it("produces a different hash each time (random salt)", async () => {
    const a = await hashPassword("ChangeMe123!");
    const b = await hashPassword("ChangeMe123!");
    expect(a).not.toEqual(b);
  });
});
