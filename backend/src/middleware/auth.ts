import type { Request, Response, NextFunction } from 'express';
import type { Role, User } from '@prisma/client';
import { prisma } from '../db/prisma.js';
import { generateToken, hashToken, hashIp } from '../lib/crypto.js';
import { env } from '../config/env.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export const SESSION_COOKIE = 'cyriq_session';
/** Stable per-browser id used for download de-duplication and view counting. */
export const VISITOR_COOKIE = 'cyriq_visitor';

export type SafeUser = Omit<User, 'passwordHash'>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SafeUser;
      sessionId?: string;
      visitorKey: string;
    }
  }
}

function cookieOptions(maxAgeMs: number) {
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: env.COOKIE_SECURE,
    domain: env.COOKIE_DOMAIN,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export async function createSession(
  userId: string,
  req: Request,
  res: Response,
): Promise<{ token: string; expiresAt: Date }> {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(token),
      expiresAt,
      userAgent: req.get('user-agent')?.slice(0, 250),
      ipHash: hashIp(req.ip),
    },
  });
  res.cookie(SESSION_COOKIE, token, cookieOptions(expiresAt.getTime() - Date.now()));
  return { token, expiresAt };
}

export async function destroySession(req: Request, res: Response): Promise<void> {
  const token = req.cookies?.[SESSION_COOKIE];
  if (token) {
    await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  }
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(0), maxAge: undefined });
}

export function stripUser(user: User): SafeUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe;
}

/**
 * Resolves the caller's identity for every request. Never rejects, because route
 * guards decide what an anonymous caller may do (PRD §60).
 */
export async function attachUser(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Stable visitor key, used only for de-duplicating downloads/views.
  let visitor = req.cookies?.[VISITOR_COOKIE];
  if (!visitor || typeof visitor !== 'string' || visitor.length < 10) {
    visitor = generateToken(16);
    res.cookie(VISITOR_COOKIE, visitor, {
      ...cookieOptions(365 * 24 * 60 * 60 * 1000),
      httpOnly: true,
    });
  }
  req.visitorKey = visitor;

  const token = req.cookies?.[SESSION_COOKIE];
  if (!token || typeof token !== 'string') return next();

  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  if (!session || session.expiresAt < new Date()) {
    if (session) await prisma.session.delete({ where: { id: session.id } }).catch(() => {});
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions(0), maxAge: undefined });
    return next();
  }

  if (session.user.status !== 'ACTIVE') {
    // Suspended or deleted accounts lose their sessions immediately.
    await prisma.session.deleteMany({ where: { userId: session.userId } });
    res.clearCookie(SESSION_COOKIE, { ...cookieOptions(0), maxAge: undefined });
    return next();
  }

  req.user = stripUser(session.user);
  req.sessionId = session.id;

  // Refresh lastUsedAt at most once an hour to avoid a write per request.
  if (Date.now() - session.lastUsedAt.getTime() > 60 * 60 * 1000) {
    prisma.session
      .update({ where: { id: session.id }, data: { lastUsedAt: new Date() } })
      .catch(() => {});
  }
  next();
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) return next(unauthorized());
    if (!roles.includes(req.user.role)) return next(forbidden());
    next();
  };
}

export const requireAdmin = requireRole('ADMIN');
