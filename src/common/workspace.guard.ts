import { CanActivate, ExecutionContext, HttpStatus, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../prisma/prisma.service';
import { can, ERROR_CODES, type Permission } from '../shared';
import { AppException } from './app-exception';
import { REQUIRED_PERMISSION } from './metadata';
import type { AppRequest } from './request-context';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves the active workspace (route `:workspaceId` param, else `X-Workspace-Id`),
 * verifies the caller is a member, rejects suspended workspaces and enforces the
 * permission matrix. Only then do services open an RLS transaction for that workspace.
 */
@Injectable()
export class WorkspaceGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const permission = this.reflector.getAllAndOverride<Permission | undefined>(REQUIRED_PERMISSION, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!permission) return true;

    const req = context.switchToHttp().getRequest<AppRequest>();
    if (!req.user) throw AppException.unauthenticated();

    const header = req.headers['x-workspace-id'];
    const workspaceId = (req.params?.workspaceId as string | undefined) ?? (typeof header === 'string' ? header : undefined);
    if (!workspaceId) {
      throw new AppException(ERROR_CODES.WORKSPACE_REQUIRED, 'X-Workspace-Id header is required', HttpStatus.BAD_REQUEST);
    }
    if (!UUID.test(workspaceId)) throw AppException.badRequest('Workspace id must be a UUID');

    const userId = req.user.id;
    const membership = await this.prisma.withUser(userId, (tx) =>
      tx.membership.findUnique({
        where: { userId_workspaceId: { userId, workspaceId } },
        include: { workspace: { select: { id: true, plan: true, status: true } } },
      }),
    );
    if (!membership) throw AppException.forbidden('You are not a member of this workspace');

    if (membership.workspace.status === 'SUSPENDED') {
      throw new AppException(
        ERROR_CODES.WORKSPACE_SUSPENDED,
        'This workspace is suspended. Contact support to restore access.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (!can(membership.role, permission)) {
      throw AppException.forbidden(`Your role (${membership.role.toLowerCase()}) cannot perform this action`);
    }

    req.workspace = {
      id: membership.workspace.id,
      role: membership.role,
      plan: membership.workspace.plan,
      status: membership.workspace.status,
    };
    return true;
  }
}
