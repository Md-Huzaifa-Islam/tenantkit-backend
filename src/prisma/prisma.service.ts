import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';

export type Tx = Prisma.TransactionClient;

export interface TenantContext {
  workspaceId: string;
  userId?: string;
}

const TX_OPTIONS = { maxWait: 5_000, timeout: 15_000 } as const;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * Runs `fn` in a transaction whose row-level-security context is the given workspace.
   * `set_config(..., true)` scopes the setting to this transaction, so it can never leak
   * to another request sharing the pooled connection.
   */
  withTenant<T>(ctx: TenantContext, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.workspace_id', ${ctx.workspaceId}, true), set_config('app.user_id', ${ctx.userId ?? ''}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }

  /** Runs `fn` with only the user context set (e.g. listing the user's own memberships). */
  withUser<T>(userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.workspace_id', '', true), set_config('app.user_id', ${userId}, true)`;
      return fn(tx);
    }, TX_OPTIONS);
  }
}
