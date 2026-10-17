import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app-exception';
import { hashToken, randomToken } from '../common/tokens';
import { ENV, type Env } from '../config/env';
import { EmailProvider } from '../email/email.provider';
import { emails } from '../email/templates';
import { PrismaService } from '../prisma/prisma.service';
import {
  ERROR_CODES,
  type ForgotPasswordInput,
  type LoginInput,
  type ResetPasswordInput,
  type SignupInput,
} from '../shared';
import { availableSlug, createWorkspaceWithOwner } from '../workspaces/workspace-factory';
import { hashPassword, verifyPassword } from './password';

const RESET_TTL_MS = 60 * 60 * 1000;
const VERIFY_TTL_MS = 48 * 60 * 60 * 1000;

export interface PublicUser {
  id: string;
  email: string;
  name: string;
  avatarUrl: string | null;
  emailVerified: boolean;
  isSuperAdmin: boolean;
}

export interface AuthResult {
  accessToken: string;
  expiresIn: number;
  refreshToken: string;
  refreshExpiresAt: Date;
  user: PublicUser;
  /** Present after signup: the slug of the first workspace. */
  workspaceSlug?: string;
}

export function toPublicUser(u: User): PublicUser {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    avatarUrl: u.avatarUrl,
    emailVerified: u.emailVerifiedAt !== null,
    isSuperAdmin: u.isSuperAdmin,
  };
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private dummyHash?: Promise<string>;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly email: EmailProvider,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async signup(input: SignupInput, ip: string | null): Promise<AuthResult> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) throw AppException.conflict('An account with this email already exists');

    const userId = randomUUID();
    const workspaceId = randomUUID();
    const slug = (await availableSlug(this.prisma, input.workspaceName))!;
    const passwordHash = await hashPassword(input.password);

    const user = await this.prisma.withTenant({ workspaceId, userId }, async (tx) => {
      const created = await tx.user.create({
        data: { id: userId, email: input.email, name: input.name, passwordHash },
      });
      await createWorkspaceWithOwner(tx, this.audit, {
        workspaceId,
        name: input.workspaceName,
        slug,
        ownerId: userId,
        ip,
      });
      return created;
    });

    await this.sendVerification(user);
    return { ...(await this.issueTokens(user)), workspaceSlug: slug };
  }

  async login(input: LoginInput): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    // Verify against a dummy hash for unknown emails so response time doesn't reveal accounts.
    const ok = user
      ? await verifyPassword(user.passwordHash, input.password)
      : await verifyPassword(await this.getDummyHash(), input.password).then(() => false);
    if (!user || !ok) throw AppException.unauthenticated('Invalid email or password');
    return this.issueTokens(user);
  }

  /**
   * Rotates a refresh token. Each token is single-use: presenting a token that was
   * already rotated means it was stolen or replayed, so the whole family is revoked.
   */
  async refresh(presented: string | undefined): Promise<AuthResult> {
    if (!presented) throw AppException.unauthenticated('No refresh token');
    const token = await this.prisma.refreshToken.findUnique({
      where: { tokenHash: hashToken(presented) },
      include: { user: true },
    });
    if (!token) throw AppException.unauthenticated('Invalid refresh token');

    if (token.revokedAt) {
      await this.revokeFamily(token.familyId);
      this.logger.warn({ userId: token.userId, familyId: token.familyId }, 'Refresh token reuse detected; family revoked');
      throw AppException.unauthenticated('Session expired, please sign in again');
    }
    if (token.expiresAt <= new Date()) throw AppException.unauthenticated('Session expired, please sign in again');

    const next = this.newRefreshToken();
    const nextId = randomUUID();
    const rotated = await this.prisma.$transaction(async (tx) => {
      // Conditional update: if a concurrent request already rotated this token, count is 0.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: token.id, revokedAt: null },
        data: { revokedAt: new Date(), replacedById: nextId },
      });
      if (count === 0) return false;
      await tx.refreshToken.create({
        data: {
          id: nextId,
          userId: token.userId,
          familyId: token.familyId,
          tokenHash: hashToken(next.value),
          expiresAt: next.expiresAt,
        },
      });
      await tx.user.update({ where: { id: token.userId }, data: { lastActiveAt: new Date() } });
      return true;
    });
    if (!rotated) {
      await this.revokeFamily(token.familyId);
      throw AppException.unauthenticated('Session expired, please sign in again');
    }

    return {
      ...this.signAccess(token.user),
      refreshToken: next.value,
      refreshExpiresAt: next.expiresAt,
      user: toPublicUser(token.user),
    };
  }

  async logout(presented: string | undefined) {
    if (!presented) return;
    const token = await this.prisma.refreshToken.findUnique({ where: { tokenHash: hashToken(presented) } });
    if (token) await this.revokeFamily(token.familyId);
  }

  async forgotPassword(input: ForgotPasswordInput) {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (!user) return; // same response either way: no account enumeration
    const token = randomToken();
    await this.prisma.passwordResetToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    });
    const url = `${this.env.APP_URL}/reset?token=${encodeURIComponent(token)}`;
    await this.email.send({ to: user.email, ...emails.resetPassword(url) });
  }

  async resetPassword(input: ResetPasswordInput) {
    const record = await this.prisma.passwordResetToken.findUnique({ where: { tokenHash: hashToken(input.token) } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) throw AppException.tokenInvalid();
    const passwordHash = await hashPassword(input.password);
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.passwordResetToken.updateMany({
        where: { id: record.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (count === 0) throw AppException.tokenInvalid();
      await tx.user.update({ where: { id: record.userId }, data: { passwordHash } });
      // A password reset signs out every existing session.
      await tx.refreshToken.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    });
  }

  async verifyEmail(token: string) {
    const record = await this.prisma.emailVerificationToken.findUnique({ where: { tokenHash: hashToken(token) } });
    if (!record || record.usedAt || record.expiresAt <= new Date()) throw AppException.tokenInvalid();
    await this.prisma.$transaction([
      this.prisma.emailVerificationToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
      this.prisma.user.update({ where: { id: record.userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
  }

  async resendVerification(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.emailVerifiedAt) {
      throw new AppException(ERROR_CODES.CONFLICT, 'Email is already verified', HttpStatus.CONFLICT);
    }
    await this.sendVerification(user);
  }

  // ---------- internals ----------

  async issueTokens(user: User): Promise<AuthResult> {
    const refresh = this.newRefreshToken();
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        familyId: randomUUID(),
        tokenHash: hashToken(refresh.value),
        expiresAt: refresh.expiresAt,
      },
    });
    await this.prisma.user.update({ where: { id: user.id }, data: { lastActiveAt: new Date() } });
    return {
      ...this.signAccess(user),
      refreshToken: refresh.value,
      refreshExpiresAt: refresh.expiresAt,
      user: toPublicUser(user),
    };
  }

  private signAccess(user: User) {
    const accessToken = this.jwt.sign(
      { sub: user.id, email: user.email, sa: user.isSuperAdmin },
      { expiresIn: this.env.JWT_ACCESS_TTL_SECONDS },
    );
    return { accessToken, expiresIn: this.env.JWT_ACCESS_TTL_SECONDS };
  }

  private newRefreshToken() {
    return {
      value: randomToken(48),
      expiresAt: new Date(Date.now() + this.env.REFRESH_TOKEN_TTL_DAYS * 86_400_000),
    };
  }

  private async revokeFamily(familyId: string) {
    await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async sendVerification(user: User) {
    const token = randomToken();
    await this.prisma.emailVerificationToken.create({
      data: { userId: user.id, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
    });
    const url = `${this.env.APP_URL}/verify?token=${encodeURIComponent(token)}`;
    await this.email.send({ to: user.email, ...emails.verify(user.name, url) });
  }

  private getDummyHash() {
    this.dummyHash ??= hashPassword(randomToken());
    return this.dummyHash;
  }
}
