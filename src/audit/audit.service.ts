import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Tx } from '../prisma/prisma.service';
import type { AuditAction } from '../shared';

export interface AuditEntry {
  workspaceId: string;
  actorId: string | null;
  action: AuditAction;
  targetType?: string;
  targetId?: string;
  metadata?: Prisma.InputJsonValue;
  ip?: string | null;
}

@Injectable()
export class AuditService {
  /**
   * Records an audit entry inside the caller's tenant transaction, so the entry is
   * committed atomically with the change it describes (and is subject to RLS).
   */
  record(tx: Tx, entry: AuditEntry) {
    return tx.auditLog.create({
      data: {
        workspaceId: entry.workspaceId,
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        metadata: entry.metadata ?? {},
        ip: entry.ip ?? null,
      },
    });
  }
}
