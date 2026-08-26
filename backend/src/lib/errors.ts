/**
 * Consistent error surface (PRD §51, §59). User-facing messages are
 * understandable and actionable; technical detail stays in the logs.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;
  /** True when the message is safe and useful to show a person. */
  readonly expose: boolean;

  constructor(
    status: number,
    code: string,
    message: string,
    options: { details?: unknown; expose?: boolean; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = options.details;
    this.expose = options.expose ?? status < 500;
  }
}

export const badRequest = (message: string, details?: unknown) =>
  new AppError(400, 'bad_request', message, { details });

export const unauthorized = (message = 'You need to sign in to do that.') =>
  new AppError(401, 'unauthorized', message);

export const forbidden = (message = 'You do not have access to that.') =>
  new AppError(403, 'forbidden', message);

export const notFound = (message = 'We could not find that.') =>
  new AppError(404, 'not_found', message);

export const gone = (message = 'That resource is no longer available.') =>
  new AppError(410, 'gone', message);

export const conflict = (message: string, details?: unknown) =>
  new AppError(409, 'conflict', message, { details });

export const tooLarge = (message: string) => new AppError(413, 'payload_too_large', message);

export const unsupportedMedia = (message: string) =>
  new AppError(415, 'unsupported_media_type', message);

export const rateLimited = (message = 'Too many requests. Give it a moment and try again.') =>
  new AppError(429, 'rate_limited', message);

export const storageFailure = (message = 'Storage is unavailable right now.', cause?: unknown) =>
  new AppError(503, 'storage_unavailable', message, { cause, expose: true });

export const internal = (message = 'Something went wrong on our end.', cause?: unknown) =>
  new AppError(500, 'internal_error', message, { cause, expose: false });
