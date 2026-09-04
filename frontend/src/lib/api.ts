/**
 * The HTTP layer.
 *
 * One place knows how to talk to the API: it sends the session cookie, aborts
 * cleanly when a caller goes away, and turns the backend's error envelope into
 * something a component can show a person without inventing a message of its
 * own. Nothing else in the app calls fetch.
 */

export interface FieldIssue {
  field: string;
  message: string;
}

export class ApiError extends Error {
  /** 0 when the request never reached the server. */
  readonly status: number;
  readonly code: string;
  readonly issues: FieldIssue[];

  constructor(status: number, code: string, message: string, issues: FieldIssue[] = []) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }

  /** The server's message for one form field, when it named one. */
  on(field: string): string | undefined {
    return this.issues.find((issue) => issue.field === field)?.message;
  }

  get offline(): boolean {
    return this.status === 0;
  }

  get unauthorized(): boolean {
    return this.status === 401;
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

interface ErrorEnvelope {
  error?: { code?: string; message?: string; details?: FieldIssue[] };
}

const PREFIX = '/api';

async function send<T>(
  method: Method,
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  let response: Response;

  try {
    response = await fetch(`${PREFIX}${path}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    // Losing the network is a distinct state a person can act on, so it is
    // never dressed up as a server error.
    throw new ApiError(
      0,
      'network_error',
      'We could not reach the server. Check your connection and try again.',
    );
  }

  if (response.status === 204) return undefined as T;

  const json = response.headers.get('content-type')?.includes('application/json')
    ? await response.json().catch(() => null)
    : null;

  if (!response.ok) {
    const envelope = (json as ErrorEnvelope | null)?.error;
    throw new ApiError(
      response.status,
      envelope?.code ?? 'error',
      envelope?.message ?? 'Something went wrong.',
      Array.isArray(envelope?.details) ? envelope.details : [],
    );
  }

  return json as T;
}

export const api = {
  get: <T>(path: string, signal?: AbortSignal) => send<T>('GET', path, undefined, signal),
  post: <T>(path: string, body?: unknown, signal?: AbortSignal) =>
    send<T>('POST', path, body ?? {}, signal),
  put: <T>(path: string, body?: unknown) => send<T>('PUT', path, body ?? {}),
  patch: <T>(path: string, body?: unknown) => send<T>('PATCH', path, body ?? {}),
  delete: <T>(path: string) => send<T>('DELETE', path),
};

/** Turns a filter object into a query string, dropping anything empty. */
export function query(params: Record<string, string | number | boolean | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
