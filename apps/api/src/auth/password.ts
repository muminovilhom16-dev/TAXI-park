import argon2 from "argon2";

// OWASP-recommended argon2id parameters (19 MiB, 2 passes).
const OPTIONS = { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(plain: string): Promise<string> {
  return argon2.hash(plain, OPTIONS);
}

let dummyHash: Promise<string> | undefined;

/**
 * Verifies a password. With no stored hash it still spends the same time on a
 * dummy hash, so response timing does not reveal whether a login exists.
 */
export async function verifyPassword(hash: string | null, plain: string): Promise<boolean> {
  if (!hash) {
    dummyHash ??= argon2.hash("dummy-password-for-timing", OPTIONS);
    await argon2.verify(await dummyHash, plain).catch(() => false);
    return false;
  }
  return argon2.verify(hash, plain).catch(() => false);
}
