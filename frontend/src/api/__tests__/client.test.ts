import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiError, buildUrl, configureClient, getToken, parseErrorBody, pingHealth, setToken } from '../client';

function res(status: number, body: unknown, ct = 'application/json') {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'content-type': ct } });
}

describe('API client', () => {
  const fetchMock = vi.fn();
  const unauthorized = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    unauthorized.mockReset();
    configureClient({ fetch: fetchMock as unknown as typeof fetch, onUnauthorized: unauthorized });
    setToken(null);
  });
  afterEach(() => setToken(null));

  it('builds URLs with the /api/v1 prefix and skips empty query values', () => {
    expect(buildUrl('/projects', { q: 'tower', status: undefined, x: '' })).toBe('/api/v1/projects?q=tower');
  });

  it('sends the bearer token and JSON body', async () => {
    setToken('tok123');
    fetchMock.mockResolvedValue(res(200, { ok: true }));
    await api.post('/x', { a: 1 });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/x');
    expect(init.headers.Authorization).toBe('Bearer tok123');
    expect(init.body).toBe('{"a":1}');
    expect(getToken()).toBe('tok123');
  });

  it('maps the standard error shape to ApiError', async () => {
    fetchMock.mockResolvedValue(res(409, { detail: { code: 'VERSION_CONFLICT', message: 'changed', issues: [{ code: 'X', severity: 'error', message: 'm' }] } }));
    const err = (await api.put('/elevations/1', {}).catch((e) => e)) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(409);
    expect(err.code).toBe('VERSION_CONFLICT');
    expect(err.message).toBe('changed');
    expect(err.issues).toHaveLength(1);
    expect(err.isConflict).toBe(true);
  });

  it('normalises FastAPI validation arrays and plain strings', () => {
    expect(parseErrorBody(422, { detail: [{ loc: ['body', 'width'], msg: 'must be > 0', type: 'greater_than' }] })).toEqual({
      code: 'VALIDATION_ERROR',
      message: 'must be > 0',
      issues: [{ code: 'GREATER_THAN', severity: 'error', message: 'must be > 0', ref: 'body.width' }],
    });
    expect(parseErrorBody(404, { detail: 'Nope' }).message).toBe('Nope');
    expect(parseErrorBody(500, null)).toEqual({ code: 'HTTP_500', message: 'Server error', issues: [] });
    expect(parseErrorBody(502, '<html>bad gateway</html>').message).toContain('bad gateway');
  });

  it('401 clears the token and calls the unauthorized handler', async () => {
    setToken('old');
    fetchMock.mockResolvedValue(res(401, { detail: { code: 'UNAUTHORIZED', message: 'expired' } }));
    await expect(api.get('/auth/me')).rejects.toMatchObject({ status: 401 });
    expect(unauthorized).toHaveBeenCalledOnce();
    expect(getToken()).toBeNull();
  });

  it('login failures do not trigger the redirect handler', async () => {
    fetchMock.mockResolvedValue(res(401, { detail: { code: 'INVALID_CREDENTIALS', message: 'bad' } }));
    await expect(api.post('/auth/login', {}, { noAuthRedirect: true })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('network failures become NETWORK_ERROR with status 0', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const err = (await api.get('/projects').catch((e) => e)) as ApiError;
    expect(err).toMatchObject({ status: 0, code: 'NETWORK_ERROR' });
    expect(err.isNetwork).toBe(true);
  });

  it('health ping requires a JSON answer (a static SPA fallback is not a server)', async () => {
    fetchMock.mockResolvedValueOnce(res(200, { status: 'ok' }));
    expect(await pingHealth()).toBe(true);
    fetchMock.mockResolvedValueOnce(res(200, '<!doctype html>', 'text/html'));
    expect(await pingHealth()).toBe(false);
    fetchMock.mockRejectedValueOnce(new TypeError('x'));
    expect(await pingHealth()).toBe(false);
  });

  it('204 resolves undefined', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));
    await expect(api.del('/x')).resolves.toBeUndefined();
  });
});
