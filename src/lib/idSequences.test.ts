// Integration test against the real inventory_test database (Vitest points
// DATABASE_URL at it — see vitest.setup.ts) — the whole point of this table
// is atomic behavior under Postgres's row locking, which a mocked DB can't
// exercise.
import { describe, it, expect } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { id_sequences } from "@/db/schema";
import { allocateNextCode } from "./idSequences";

describe("idSequences", () => {
  it("allocates a formatted, incrementing code", async () => {
    const [before] = await db.select().from(id_sequences).where(eq(id_sequences.sequence_key, "product_code"));
    const code = await allocateNextCode(db, "product_code");
    expect(code).toBe(`STIC${String(before.current_value + 1).padStart(3, "0")}`);
  });

  it("never allocates the same code twice under concurrent callers", async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () => allocateNextCode(db, "invoice_number")),
    );
    expect(new Set(results).size).toBe(10);
  });
});
