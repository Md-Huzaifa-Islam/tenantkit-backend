import { applyDecorators, createParamDecorator, ExecutionContext, SetMetadata, UseGuards } from '@nestjs/common';
import { ApiHeader } from '@nestjs/swagger';
import type { Permission } from '../shared';
import { AppException } from './app-exception';
import { IS_PUBLIC, REQUIRED_PERMISSION, SUPER_ADMIN } from './metadata';
import { SuperAdminGuard } from './super-admin.guard';
import { WorkspaceGuard } from './workspace.guard';
import type { AppRequest, AuthUser, WorkspaceContext } from './request-context';

export { IS_PUBLIC, REQUIRED_PERMISSION, SUPER_ADMIN };

/** Skip JWT authentication for a route or controller. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Requires an `X-Workspace-Id` the caller is a member of, and a role that grants
 * `permission` in the shared permission matrix.
 */
export const RequirePermission = (permission: Permission) =>
  applyDecorators(
    SetMetadata(REQUIRED_PERMISSION, permission),
    UseGuards(WorkspaceGuard),
    ApiHeader({ name: 'X-Workspace-Id', required: true, description: `Requires permission \`${permission}\`` }),
  );

/** Restricts a route to platform super admins (re-checked against the database). */
export const SuperAdminOnly = () =>
  applyDecorators(SetMetadata(SUPER_ADMIN, true), UseGuards(SuperAdminGuard));

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
