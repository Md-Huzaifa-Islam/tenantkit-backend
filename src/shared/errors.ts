/** Stable machine-readable error codes in `{ error: { code, message, details } }`. */
export const ERROR_CODES = {
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  RATE_LIMITED: 'RATE_LIMITED',
  PLAN_LIMIT_REACHED: 'PLAN_LIMIT_REACHED',
  WORKSPACE_SUSPENDED: 'WORKSPACE_SUSPENDED',
  WORKSPACE_REQUIRED: 'WORKSPACE_REQUIRED',
  TOKEN_INVALID: 'TOKEN_INVALID',
  INTERNAL: 'INTERNAL',
} as const;
export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

export interface ApiErrorBody {
  error: { code: ErrorCode | string; message: string; details?: unknown };
}
