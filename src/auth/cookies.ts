import type { Response } from 'express';
import type { Env } from '../config/env';

export const REFRESH_COOKIE = 'tk_refresh';
/**
 * Readable hint (value "1", no secret) so the web app only attempts a silent refresh
 * when a session may exist, instead of firing a guaranteed 401 for signed-out visitors.
 */
export const SESSION_HINT_COOKIE = 'tk_session';
// Only sent to the auth endpoints that need it.
const COOKIE_PATH = '/api/v1/auth';

export function setRefreshCookie(res: Response, env: Env, token: string, expires: Date) {
  res.cookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: COOKIE_PATH,
    expires,
  });
  res.cookie(SESSION_HINT_COOKIE, '1', { httpOnly: false, secure: env.COOKIE_SECURE, sameSite: 'lax', path: '/', expires });
}

export function clearRefreshCookie(res: Response, env: Env) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: COOKIE_PATH,
  });
  res.clearCookie(SESSION_HINT_COOKIE, { httpOnly: false, secure: env.COOKIE_SECURE, sameSite: 'lax', path: '/' });
}
