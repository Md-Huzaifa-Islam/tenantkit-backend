import type { Response } from 'express';
import type { Env } from '../config/env';

export const REFRESH_COOKIE = 'tk_refresh';
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
}

export function clearRefreshCookie(res: Response, env: Env) {
  res.clearCookie(REFRESH_COOKIE, {
    httpOnly: true,
    secure: env.COOKIE_SECURE,
    sameSite: 'lax',
    path: COOKIE_PATH,
  });
}
