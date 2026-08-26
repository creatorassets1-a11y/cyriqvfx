import pino from 'pino';
import { env } from '../config/env.js';

/**
 * Structured logging (PRD §90). Secrets, signed URLs and credentials are
 * redacted before they can reach a log sink.
 */
export const logger = pino({
  level: env.isTest ? 'silent' : env.LOG_LEVEL,
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers.cookie',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'token',
      'tokenHash',
      'signedUrl',
      'url',
      '*.password',
      '*.token',
      '*.secret',
      '*.accessKeyId',
      '*.secretAccessKey',
    ],
    censor: '[redacted]',
  },
  base: undefined,
  timestamp: pino.stdTimeFunctions.isoTime,
});

export type Logger = typeof logger;
