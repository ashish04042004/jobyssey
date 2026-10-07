import { hash, verify } from '@node-rs/argon2';

// Library defaults are argon2id with OWASP-recommended cost (m=19 MiB, t=2, p=1).
export function hashPassword(password) {
  return hash(password);
}

export async function verifyPassword(passwordHash, password) {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

// Verifying against this when the email is unknown keeps login timing the same
// for existing and non-existing accounts.
let dummyHash;
export async function burnPasswordCheck(password) {
  dummyHash ??= await hash('jobyssey-timing-equaliser');
  await verifyPassword(dummyHash, password);
}
