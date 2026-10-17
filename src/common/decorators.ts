import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Permission } from '../shared';
import { AppException } from './app-exception';
import type { AppRequest, AuthUser, WorkspaceContext } from './request-context';

export const IS_PUBLIC = 'isPublic';
/** Skip JWT authentication for a route or controller. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export const REQUIRED_PERMISSION = 'requiredPermission';
/**
 * Requires an `X-Workspace-Id` the caller is a member of, and a role that grants
 * `permission` in the shared permission matrix.
 */
export const RequirePermission = (permission: Permission) =>
  SetMetadata(REQUIRED_PERMISSION, permission);

export const SUPER_ADMIN = 'superAdmin';
/** Restricts a route to platform super admins (re-checked against the database). */
export const SuperAdminOnly = () => SetMetadata(SUPER_ADMIN, true);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AppRequest>().user;
  if (!user) throw AppException.unauthenticated();
  return user;
});

export const CurrentWorkspace = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): WorkspaceContext => {
    const workspace = ctx.switchToHttp().getRequest<AppRequest>().workspace;
    if (!workspace) throw AppException.forbidden('Workspace context missing');
    return workspace;
  },
);

/** Client IP (honours one trusted proxy hop via Express `trust proxy`). */
export const ClientIp = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): string | null =>
    ctx.switchToHttp().getRequest<AppRequest>().ip ?? null,
);
