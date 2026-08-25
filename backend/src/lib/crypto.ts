import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2';
import { env } from '../config/env.js';

/** OWASP-aligned Argon2id parameters. */
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return argonHash(password, ARGON_OPTS);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argonVerify(hash, password);
  } catch {
    return false;
  }
}

/** Opaque, high-entropy token handed to the client. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Tokens are stored only as keyed hashes, so a database leak does not yield
 * usable session or reset tokens.
 */
export function hashToken(token: string): string {
  return createHmac('sha256', env.AUTH_SECRET).update(token).digest('hex');
}

export function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

/** Pseudonymised IP for rate limiting and audit context (PRD §63). */
export function hashIp(ip: string | undefined): string | undefined {
  if (!ip) return undefined;
  return createHmac('sha256', env.AUTH_SECRET).update(ip).digest('hex').slice(0, 32);
}

export function sha256(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

/**
 * Public download tokens appear in shareable URLs. They are unguessable and
 * carry no storage information (PRD §15).
 */
export function generateDownloadToken(): string {
  return randomBytes(12).toString('base64url');
}

export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}
