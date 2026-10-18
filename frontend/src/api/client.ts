/**
 * Typed REST client for /api/v1.
 *
 * - JWT kept in memory and mirrored to sessionStorage (tab-scoped; survives reload, not new tabs).
 * - Every non-2xx response becomes an ApiError with the standard shape
 *   `{detail: {code, message, issues}}` (FastAPI string/array details are normalised too).
 * - 401 clears the token and invokes the registered unauthorized handler (-> login redirect).
 */
import type { ApiErrorBody, Issue } from './types';

export const API_BASE = '/api/v1';
const TOKEN_KEY = 'fos.token';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues: Issue[];
  readonly body: unknown;

  constructor(status: number, code: string, message: string, issues: Issue[] = [], body: unknown = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
    this.body = body;
  }

  get isConflict(): boolean {
    return this.status === 409;
  }
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

interface ClientConfig {
  fetch: FetchLike;
  onUnauthorized: (() => void) | null;
}

const config: ClientConfig = {
  fetch: (input, init) => globalThis.fetch(input, init),
  onUnauthorized: null,
};

let memoryToken: string | null = null;

function storage(): Storage | null {
  try {
    return typeof sessionStorage !== 'undefined' ? sessionStorage : null;
  } catch {
    return null;
  }
}

export function getToken(): string | null {
  if (memoryToken) return memoryToken;
  try {
    memoryToken = storage()?.getItem(TOKEN_KEY) ?? null;
  } catch {
    memoryToken = null;
  }
  return memoryToken;
}

export function setToken(token: string | null): void {
  memoryToken = token;
  try {
    const s = storage();
    if (!s) return;
    if (token) s.setItem(TOKEN_KEY, token);
    else s.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: memory only */
  }
}

export function configureClient(partial: Partial<ClientConfig>): void {
  Object.assign(config, partial);
}

/** Normalise any error payload into {code, message, issues}. */
export function parseErrorBody(status: number, body: unknown): { code: string; message: string; issues: Issue[] } {
  const fallback = { code: `HTTP_${status}`, message: defaultMessage(status), issues: [] as Issue[] };
  if (!body || typeof body !== 'object') {
    if (typeof body === 'string' && body.trim()) return { ...fallback, message: body.slice(0, 300) };
    return fallback;
  }
  const detail = (body as ApiErrorBody).detail as unknown;
  if (typeof detail === 'string') return { ...fallback, message: detail };
  if (Array.isArray(detail)) {
    // FastAPI/pydantic validation errors: [{loc, msg, type}]
    const issues: Issue[] = detail.map((d: { loc?: unknown[]; msg?: string; type?: string }) => ({
      code: (d.type ?? 'VALIDATION').toUpperCase(),
      severity: 'error',
      message: d.msg ?? 'Invalid value',
      ref: Array.isArray(d.loc) ? d.loc.join('.') : null,
    }));
    return { code: 'VALIDATION_ERROR', message: issues[0]?.message ?? 'Request validation failed', issues };
  }
  if (detail && typeof detail === 'object') {
    const d = detail as { code?: string; message?: string; issues?: Issue[] };
    return {
      code: d.code ?? fallback.code,
      message: d.message ?? fallback.message,
      issues: Array.isArray(d.issues) ? d.issues : [],
    };
  }
  return fallback;
}

function defaultMessage(status: number): string {
  switch (status) {
    case 400:
      return 'Bad request';
    case 401:
      return 'Session expired — please sign in again';
    case 403:
      return 'You do not have permission for this action';
    case 404:
      return 'Not found';
    case 409:
      return 'Conflict — the record was changed by someone else';
    case 422:
      return 'Validation failed';
    default:
      return status >= 500 ? 'Server error' : `Request failed (${status})`;
  }
}

export interface RequestOptions {
  body?: unknown;
  form?: FormData;
  query?: Record<string, string | number | boolean | null | undefined>;
  signal?: AbortSignal;
  /** do not trigger the 401 redirect handler (e.g. for the login call itself) */
  noAuthRedirect?: boolean;
  /** return the raw Response (for downloads) */
  raw?: boolean;
}

export function buildUrl(path: string, query?: RequestOptions['query']): string {
  const qs = query
    ? Object.entries(query)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
        .join('&')
    : '';
  return `${API_BASE}${path.startsWith('/') ? path : `/${path}`}${qs ? `?${qs}` : ''}`;
}

export async function request<T>(method: string, path: string, opts: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await config.fetch(buildUrl(path, opts.query), { method, headers, body, signal: opts.signal });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') throw e;
    throw new ApiError(0, 'NETWORK_ERROR', 'Server unreachable — check your connection or use offline demo mode');
  }
  if (res.status === 401 && !opts.noAuthRedirect) {
    setToken(null);
    config.onUnauthorized?.();
  }
  if (!res.ok) {
    let parsed: unknown = null;
    try {
      const text = await res.text();
      try {
        parsed = text ? JSON.parse(text) : null;
      } catch {
        parsed = text;
      }
    } catch {
      parsed = null;
    }
    const { code, message, issues } = parseErrorBody(res.status, parsed);
    throw new ApiError(res.status, code, message, issues, parsed);
  }
  if (opts.raw) return res as unknown as T;
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T>(path: string, opts?: RequestOptions) => request<T>('GET', path, opts),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('POST', path, { ...opts, body }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>('PUT', path, { ...opts, body }),
  del: <T>(path: string, opts?: RequestOptions) => request<T>('DELETE', path, opts),
  upload: <T>(path: string, file: File | Blob, field = 'file', opts?: RequestOptions) => {
    const form = new FormData();
    form.append(field, file);
    return request<T>('POST', path, { ...opts, form });
  },
  /** Download a document (PDF/XLSX) and hand it to the browser. */
  async download(path: string, filename: string): Promise<void> {
    const res = await request<Response>('GET', path, { raw: true });
    const blob = await res.blob();
    saveBlob(blob, filename);
  },
};

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Ping /health with a short timeout. Resolves true when the server answers 2xx. */
/**
 * Is the API reachable? Serverless hosts (Vercel) cold-start the Python API in several seconds, and the first
 * health call can return 503 while start-up migration/seed runs, so retry with a generous timeout.
 */
export async function waitForHealth(opts: { attempts?: number; timeoutMs?: number; onAttempt?: (n: number) => void } = {}): Promise<boolean> {
  const attempts = opts.attempts ?? 4;
  for (let i = 1; i <= attempts; i++) {
    opts.onAttempt?.(i);
    if (await pingHealth(opts.timeoutMs ?? 15000)) return true;
    if (i < attempts) await new Promise((r) => setTimeout(r, Math.min(4000, 1000 * i)));
  }
  return false;
}

export async function pingHealth(timeoutMs = 2500): Promise<boolean> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await config.fetch(buildUrl('/health'), { signal: ctrl.signal });
    if (!res.ok) return false;
    const ct = res.headers.get('content-type') ?? '';
    // a static host returning index.html for unknown routes is NOT a backend
    return ct.includes('application/json');
  } catch {
    return false;
  } finally {
    clearTimeout(t);
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}
