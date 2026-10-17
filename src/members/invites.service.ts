import { Inject, Injectable } from '@nestjs/common';
import type { Invite } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AuthResult, AuthService } from '../auth/auth.service';
import { hashPassword } from '../auth/password';
import { PlanLimitsService } from '../billing/plan-limits.service';
import { AppException } from '../common/app-exception';
import type { AuthUser, WorkspaceContext } from '../common/request-context';
import { hashToken, randomToken } from '../common/tokens';
import { ENV, type Env } from '../config/env';
import { EmailProvider } from '../email/email.provider';
import { emails } from '../email/templates';
import { PrismaService, type Tx } from '../prisma/prisma.service';
import type { AcceptInviteInput, CreateInviteInput } from '../shared';

const INVITE_TTL_MS = 7 * 86_400_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Invite tokens look like `<workspaceId>.<secret>`. Only sha256(secret) is stored.
 * The workspace prefix lets us open the right RLS context before looking the invite up.
 */
function parseToken(token: string): { workspaceId: string; secret: string } {
  const [workspaceId, secret, ...rest] = token.split('.');
  if (!workspaceId || !secret || rest.length > 0 || !UUID.test(workspaceId)) throw AppException.tokenInvalid();
  return { workspaceId, secret };
}

const isPending = (i: Invite) => !i.acceptedAt && !i.revokedAt && i.expiresAt > new Date();

@Injectable()
export class InvitesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly limits: PlanLimitsService,
    private readonly email: EmailProvider,
    private readonly auth: AuthService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async create(ws: WorkspaceContext, actor: AuthUser, input: CreateInviteInput, ip: string | null) {
    const secret = randomToken();
    const { invite, workspaceName, inviterName } = await this.prisma.withTenant(
      { workspaceId: ws.id, userId: actor.id },
      async (tx) => {
        const existingMember = await tx.membership.findFirst({
          where: { workspaceId: ws.id, user: { email: input.email } },
        });
        if (existingMember) throw AppException.conflict('This person is already a member');
        const pending = await tx.invite.findFirst({
          where: { workspaceId: ws.id, email: input.email, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
        });
        if (pending) throw AppException.conflict('An invitation is already pending for this email. Resend it instead.');

        await this.limits.assertCanAdd(tx, ws, 'members');

        const created = await tx.invite.create({
          data: {
            workspaceId: ws.id,
            email: input.email,
            role: input.role,
            tokenHash: hashToken(secret),
            invitedById: actor.id,
            expiresAt: new Date(Date.now() + INVITE_TTL_MS),
          },
        });
        await this.audit.record(tx, {
          workspaceId: ws.id,
          actorId: actor.id,
          action: 'member.invited',
          targetType: 'invite',
          targetId: created.id,
          metadata: { email: input.email, role: input.role },
          ip,
        });
        const [workspace, inviter] = await Promise.all([
          tx.workspace.findUniqueOrThrow({ where: { id: ws.id }, select: { name: true } }),
          tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { name: true } }),
        ]);
        return { invite: created, workspaceName: workspace.name, inviterName: inviter.name };
      },
    );

    await this.sendEmail(invite, `${ws.id}.${secret}`, workspaceName, inviterName);
    return this.toDto(invite);
  }

  list(ws: WorkspaceContext, userId: string) {
    return this.prisma.withTenant({ workspaceId: ws.id, userId }, async (tx) => {
      const invites = await tx.invite.findMany({
        where: { workspaceId: ws.id, acceptedAt: null, revokedAt: null },
        include: { invitedBy: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
      });
      return invites.map((i) => ({ ...this.toDto(i), invitedBy: i.invitedBy.name }));
    });
  }

  async resend(ws: WorkspaceContext, actor: AuthUser, inviteId: string, ip: string | null) {
    const secret = randomToken();
    const { invite, workspaceName, inviterName } = await this.prisma.withTenant(
      { workspaceId: ws.id, userId: actor.id },
      async (tx) => {
        const existing = await this.findOpen(tx, ws.id, inviteId);
        // A fresh token invalidates the old link; the expiry restarts.
        const updated = await tx.invite.update({
          where: { id: existing.id },
          data: { tokenHash: hashToken(secret), expiresAt: new Date(Date.now() + INVITE_TTL_MS), invitedById: actor.id },
        });
        await this.audit.record(tx, {
          workspaceId: ws.id,
          actorId: actor.id,
          action: 'member.invite_resent',
          targetType: 'invite',
          targetId: existing.id,
          metadata: { email: existing.email },
          ip,
        });
        const [workspace, inviter] = await Promise.all([
          tx.workspace.findUniqueOrThrow({ where: { id: ws.id }, select: { name: true } }),
          tx.user.findUniqueOrThrow({ where: { id: actor.id }, select: { name: true } }),
        ]);
        return { invite: updated, workspaceName: workspace.name, inviterName: inviter.name };
      },
    );
    await this.sendEmail(invite, `${ws.id}.${secret}`, workspaceName, inviterName);
    return this.toDto(invite);
  }

  revoke(ws: WorkspaceContext, actor: AuthUser, inviteId: string, ip: string | null) {
    return this.prisma.withTenant({ workspaceId: ws.id, userId: actor.id }, async (tx) => {
      const existing = await this.findOpen(tx, ws.id, inviteId);
      await tx.invite.update({ where: { id: existing.id }, data: { revokedAt: new Date() } });
      await this.audit.record(tx, {
        workspaceId: ws.id,
        actorId: actor.id,
        action: 'member.invite_revoked',
        targetType: 'invite',
        targetId: existing.id,
        metadata: { email: existing.email },
        ip,
      });
    });
  }

  /** Public: what the accept page shows before the user commits. */
  async preview(token: string) {
    const { workspaceId, secret } = parseToken(token);
    return this.prisma.withTenant({ workspaceId }, async (tx) => {
      const invite = await tx.invite.findUnique({
        where: { tokenHash: hashToken(secret) },
        include: { workspace: { select: { name: true, logoUrl: true } }, invitedBy: { select: { name: true } } },
      });
      if (!invite || !isPending(invite)) throw AppException.tokenInvalid('This invitation is invalid or has expired');
      const account = await tx.user.findUnique({ where: { email: invite.email }, select: { id: true } });
      return {
        email: invite.email,
        role: invite.role,
        workspace: invite.workspace,
        invitedBy: invite.invitedBy.name,
        accountExists: Boolean(account),
        expiresAt: invite.expiresAt,
      };
    });
  }

  /**
   * Magic-link acceptance. The link was delivered to the invited address, which proves
   * control of it (like a password-reset link), so accepting signs the user in. New users
   * set their name and password here; their email counts as verified.
   */
  async accept(input: AcceptInviteInput, ip: string | null): Promise<AuthResult & { workspaceSlug: string }> {
    const { workspaceId, secret } = parseToken(input.token);
    const passwordHash = input.password ? await hashPassword(input.password) : undefined;

    const result = await this.prisma.withTenant({ workspaceId }, async (tx) => {
      const invite = await tx.invite.findUnique({ where: { tokenHash: hashToken(secret) } });
      if (!invite || !isPending(invite)) throw AppException.tokenInvalid('This invitation is invalid or has expired');

      let user = await tx.user.findUnique({ where: { email: invite.email } });
      if (!user) {
        if (!input.name || !passwordHash) {
          throw AppException.badRequest('Name and password are required to create your account', {
            issues: [
              ...(input.name ? [] : [{ path: 'name', message: 'Name is required' }]),
              ...(passwordHash ? [] : [{ path: 'password', message: 'Password is required' }]),
            ],
          });
        }
        user = await tx.user.create({
          data: { id: randomUUID(), email: invite.email, name: input.name, passwordHash, emailVerifiedAt: new Date() },
        });
      } else if (!user.emailVerifiedAt) {
        user = await tx.user.update({ where: { id: user.id }, data: { emailVerifiedAt: new Date() } });
      }

      // Single use: the conditional update fails if a concurrent accept got here first.
      const { count } = await tx.invite.updateMany({
        where: { id: invite.id, acceptedAt: null, revokedAt: null },
        data: { acceptedAt: new Date() },
      });
      if (count === 0) throw AppException.tokenInvalid('This invitation has already been used');

      const already = await tx.membership.findUnique({
        where: { userId_workspaceId: { userId: user.id, workspaceId } },
      });
      if (!already) {
        await tx.membership.create({ data: { userId: user.id, workspaceId, role: invite.role } });
        await this.audit.record(tx, {
          workspaceId,
          actorId: user.id,
          action: 'member.joined',
          targetType: 'membership',
          targetId: user.id,
          metadata: { email: user.email, role: invite.role, inviteId: invite.id },
          ip,
        });
      }
      const workspace = await tx.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { slug: true, status: true } });
      if (workspace.status === 'SUSPENDED') throw AppException.forbidden('This workspace is suspended');
      return { user, slug: workspace.slug };
    });

    return { ...(await this.auth.issueTokens(result.user)), workspaceSlug: result.slug };
  }

  private async findOpen(tx: Tx, workspaceId: string, inviteId: string) {
    if (!UUID.test(inviteId)) throw AppException.notFound('Invitation');
    const invite = await tx.invite.findFirst({ where: { id: inviteId, workspaceId } });
    if (!invite || invite.acceptedAt || invite.revokedAt) throw AppException.notFound('Invitation');
    return invite;
  }

  private async sendEmail(invite: Invite, token: string, workspaceName: string, inviterName: string) {
    const url = `${this.env.APP_URL}/invite/${encodeURIComponent(token)}`;
    await this.email.send({ to: invite.email, ...emails.invite(inviterName, workspaceName, invite.role, url) });
  }

  private toDto(i: Invite) {
    return {
      id: i.id,
      email: i.email,
      role: i.role,
      expiresAt: i.expiresAt,
      createdAt: i.createdAt,
      status: i.acceptedAt ? 'ACCEPTED' : i.revokedAt ? 'REVOKED' : i.expiresAt <= new Date() ? 'EXPIRED' : 'PENDING',
    };
  }
}
