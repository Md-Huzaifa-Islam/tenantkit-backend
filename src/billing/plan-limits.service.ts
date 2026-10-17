import { HttpStatus, Injectable } from '@nestjs/common';
import type { Plan } from '@prisma/client';
import { AppException } from '../common/app-exception';
import type { Tx } from '../prisma/prisma.service';
import { ERROR_CODES, limitFor, PLANS, type LimitKind } from '../shared';

/**
 * Server-side plan limits. Must be called inside the tenant transaction that performs
 * the insert: the advisory lock serialises concurrent creates in the same workspace,
 * so two parallel requests can't both squeeze past the limit.
 */
@Injectable()
export class PlanLimitsService {
  async assertCanAdd(tx: Tx, workspace: { id: string; plan: Plan }, kind: LimitKind) {
    const limit = limitFor(workspace.plan, kind);
    if (limit === null) return;

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`${workspace.id}:${kind}`}))`;
    const current = await this.usage(tx, workspace.id, kind);
    if (current >= limit) {
      const noun = kind === 'projects' ? 'projects' : 'members (including pending invites)';
      throw new AppException(
        ERROR_CODES.PLAN_LIMIT_REACHED,
        `The ${PLANS[workspace.plan].name} plan allows ${limit} ${noun}. Upgrade to add more.`,
        HttpStatus.PAYMENT_REQUIRED,
        { kind, limit, current, plan: workspace.plan },
      );
    }
  }

  async usage(tx: Tx, workspaceId: string, kind: LimitKind): Promise<number> {
    if (kind === 'projects') return tx.project.count({ where: { workspaceId } });
    const [members, invites] = await Promise.all([
      tx.membership.count({ where: { workspaceId } }),
      tx.invite.count({
        where: { workspaceId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      }),
    ]);
    return members + invites;
  }
}
