// Password hashing and session tokens using WebCrypto (available in Workers).
//
// PBKDF2 iterations are kept modest because the Workers Free plan allows ~10 ms
// of CPU per request. Protection comes from several layers together:
// per-user random salt, an optional server-side pepper (AUTH_PEPPER secret),
// a 12+ character password rule, and login rate limiting.

export const PBKDF2_ITERATIONS = 10_000;

const enc = new TextEncoder();

export function toHex(buf: ArrayBuffer | Uint8Array): string {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function randomHex(bytes: number): string {
  return toHex(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(s: string): Promise<string> {
  return toHex(await crypto.subtle.digest('SHA-256', enc.encode(s)));
}

export async function hashPassword(password: string, saltHex: string, iterations: number, pepper = ''): Promise<string> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password + pepper), 'PBKDF2', false, ['deriveBits']);
  const salt = new Uint8Array(saltHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256);
  return toHex(bits);
}

/** Constant-time comparison of two hex strings. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function validatePassword(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 12) return 'Password must have at least 12 characters.';
  if (pw.length > 200) return 'Password is too long.';
  return null;
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const s = parts.length >= 2 ? parts[0][0] + parts[parts.length - 1][0] : (parts[0] ?? '?').slice(0, 2);
  return s.toUpperCase();
}
