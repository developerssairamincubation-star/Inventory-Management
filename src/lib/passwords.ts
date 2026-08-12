// bcryptjs (pure JS, no native build step — matters for the slim Docker
// image) over argon2/native bcrypt. See the migration plan for rationale.
import bcrypt from "bcryptjs";

const COST_FACTOR = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, COST_FACTOR);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
