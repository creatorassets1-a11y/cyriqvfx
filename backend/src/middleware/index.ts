import type { Request, Response, NextFunction, RequestHandler } from 'express';
import rateLimit, { type Options } from 'express-rate-limit';
import { ZodError, type ZodSchema } from 'zod';
import { Prisma } from '@prisma/client';
import { AppError, badRequest, rateLimited } from '../lib/errors.js';
import { logger } from '../lib/logger.js';
import { env } from '../config/env.js';
import { hashIp } from '../lib/crypto.js';

/** Wraps async handlers so rejected promises reach the error handler. */
export function asyncHandler<T extends RequestHandler>(fn: T): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

/** Request → validation → handler (PRD §60). */
export function validate<T>(
  schema: ZodSchema<T>,
  source: 'body' | 'query' | 'params' = 'body',
) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      return next(
        badRequest('Some of that input was not valid.', formatZodIssues(result.error)),
      );
    }
    // Query objects on Express are read-only getters in v5; attach separately.
    if (source === 'query') {
      (req as Request & { validatedQuery?: unknown }).validatedQuery = result.data;
    } else {
      req[source] = result.data as never;
    }
    next();
  };
}

export function validatedQuery<T>(req: Request): T {
  return (req as Request & { validatedQuery: T }).validatedQuery;
}

function formatZodIssues(error: ZodError): Array<{ field: string; message: string }> {
  return error.issues.map((issue) => ({
    field: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

/**
 * Rate limiting (PRD §61). Limits are keyed on a hashed IP so we never store
 * raw addresses, and are disabled in tests so suites stay deterministic.
 */
export function makeLimiter(opts: {
  windowMs: number;
  limit: number;
  name: string;
  skipSuccessful?: boolean;
}): RequestHandler {
  if (env.RATE_LIMIT_DISABLED) return (_req, _res, next) => next();
  const options: Partial<Options> = {
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    skipSuccessfulRequests: opts.skipSuccessful ?? false,
    keyGenerator: (req) => hashIp(req.ip) ?? 'unknown',
    handler: (_req, _res, next) => next(rateLimited()),
  };
  return rateLimit(options);
}

export const limiters = {
  auth: makeLimiter({ windowMs: 15 * 60 * 1000, limit: 20, name: 'auth', skipSuccessful: true }),
  // Generous enough that a shared address (an office, a campus, a carrier NAT)
  // never hits it in normal use, tight enough to stop scripted signups.
  register: makeLimiter({ windowMs: 60 * 60 * 1000, limit: 30, name: 'register' }),
  passwordReset: makeLimiter({ windowMs: 60 * 60 * 1000, limit: 8, name: 'password-reset' }),
  // Generous: browsing a library is normal behaviour, not abuse.
  read: makeLimiter({ windowMs: 60 * 1000, limit: 300, name: 'read' }),
  search: makeLimiter({ windowMs: 60 * 1000, limit: 120, name: 'search' }),
  download: makeLimiter({ windowMs: 60 * 1000, limit: 40, name: 'download' }),
  write: makeLimiter({ windowMs: 60 * 1000, limit: 60, name: 'write' }),
  upload: makeLimiter({ windowMs: 60 * 1000, limit: 120, name: 'upload' }),
  report: makeLimiter({ windowMs: 60 * 60 * 1000, limit: 10, name: 'report' }),
};

export function notFoundHandler(_req: Request, res: Response): void {
  res.status(404).json({ error: { code: 'not_found', message: 'That endpoint does not exist.' } });
}

/** Single error surface for the whole API (PRD §51). */
export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
): void {
  let status = 500;
  let code = 'internal_error';
  let message = 'Something went wrong on our end.';
  let details: unknown;

  if (err instanceof AppError) {
    status = err.status;
    code = err.code;
    details = err.details;
    message = err.expose ? err.message : message;
  } else if (err instanceof ZodError) {
    status = 400;
    code = 'bad_request';
    message = 'Some of that input was not valid.';
    details = formatZodIssues(err);
  } else if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      status = 409;
      code = 'conflict';
      const target = (err.meta?.target as string[] | undefined)?.join(', ');
      message = target ? `That ${target} is already taken.` : 'That already exists.';
    } else if (err.code === 'P2025') {
      status = 404;
      code = 'not_found';
      message = 'We could not find that.';
    } else {
      status = 400;
      code = 'database_error';
      message = 'That request could not be completed.';
    }
  } else if (err instanceof Prisma.PrismaClientInitializationError) {
    status = 503;
    code = 'database_unavailable';
    message = 'The database is unavailable right now. Please try again shortly.';
  }

  const log = status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
  log(
    {
      err: err instanceof Error ? { message: err.message, stack: err.stack, name: err.name } : err,
      requestId: res.getHeader('x-request-id'),
      route: `${req.method} ${req.originalUrl.split('?')[0]}`,
      status,
      code,
      userId: req.user?.id,
    },
    'request failed',
  );

  if (res.headersSent) return;
  res.status(status).json({ error: { code, message, ...(details ? { details } : {}) } });
}
