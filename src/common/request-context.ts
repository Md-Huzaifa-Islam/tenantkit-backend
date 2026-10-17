import type { Plan, WorkspaceStatus } from '@prisma/client';
import type { Request } from 'express';
import type { Role } from '../shared';

export interface AuthUser {
  id: string;
  email: string;
  isSuperAdmin: boolean;
  /** Set when a super admin is viewing as this user (read-only). */
  impersonatorId?: string;
  readOnly?: boolean;
}

/** Set by the workspace guard after verifying membership of `X-Workspace-Id`. */
export interface WorkspaceContext {
  id: string;
  role: Role;
  plan: Plan;
  status: WorkspaceStatus;
}

export interface AppRequest extends Request {
  user?: AuthUser;
  workspace?: WorkspaceContext;
}
