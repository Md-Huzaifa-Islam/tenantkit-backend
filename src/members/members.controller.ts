import { Body, Controller, Delete, Get, HttpCode, Inject, Param, ParseUUIDPipe, Patch, Post, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { setRefreshCookie } from '../auth/cookies';
import { ClientIp, CurrentUser, CurrentWorkspace, Public, RequirePermission } from '../common/decorators';
import type { AuthUser, WorkspaceContext } from '../common/request-context';
import { ENV, env, type Env } from '../config/env';
import { AcceptInviteDto, CreateInviteDto, PreviewInviteDto, UpdateMemberRoleDto } from './dto';
import { InvitesService } from './invites.service';
import { MembersService } from './members.service';

@ApiTags('members')
@ApiBearerAuth()
@Controller()
export class MembersController {
  constructor(
    private readonly members: MembersService,
    private readonly invites: InvitesService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  // ---------- members ----------
  @Get('workspaces/:workspaceId/members')
  @RequirePermission('member.read')
  list(@CurrentWorkspace() ws: WorkspaceContext, @CurrentUser() user: AuthUser) {
    return this.members.list(ws, user.id);
  }

  @Patch('members/:id')
  @RequirePermission('member.updateRole')
  updateRole(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: UpdateMemberRoleDto,
    @ClientIp() ip: string | null,
  ) {
    return this.members.updateRole(ws, user, id, body.role, ip);
  }

  @Delete('members/:id')
  @HttpCode(204)
  @RequirePermission('member.remove')
  async remove(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
  ) {
    await this.members.remove(ws, user, id, ip);
  }

  // ---------- invites ----------
  @Post('workspaces/:workspaceId/invites')
  @RequirePermission('member.invite')
  invite(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @Body() body: CreateInviteDto,
    @ClientIp() ip: string | null,
  ) {
    return this.invites.create(ws, user, body, ip);
  }

  @Get('workspaces/:workspaceId/invites')
  @RequirePermission('member.invite')
  listInvites(@CurrentWorkspace() ws: WorkspaceContext, @CurrentUser() user: AuthUser) {
    return this.invites.list(ws, user.id);
  }

  @Post('invites/:id/resend')
  @HttpCode(200)
  @RequirePermission('member.invite')
  resend(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
  ) {
    return this.invites.resend(ws, user, id, ip);
  }

  @Delete('invites/:id')
  @HttpCode(204)
  @RequirePermission('member.invite')
  async revoke(
    @CurrentWorkspace() ws: WorkspaceContext,
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ClientIp() ip: string | null,
  ) {
    await this.invites.revoke(ws, user, id, ip);
  }

  @Public()
  @Throttle({ default: { limit: env().AUTH_RATE_LIMIT_PER_MINUTE * 3, ttl: 60_000 } })
  @Post('invites/preview')
  @HttpCode(200)
  @ApiOperation({ summary: 'Describe an invitation for the accept page' })
  preview(@Body() body: PreviewInviteDto) {
    return this.invites.preview(body.token);
  }

  @Public()
  @Throttle({ default: { limit: env().AUTH_RATE_LIMIT_PER_MINUTE, ttl: 60_000 } })
  @Post('invites/accept')
  @HttpCode(200)
  @ApiOperation({ summary: 'Accept an invitation (magic link): joins the workspace and signs in' })
  async accept(@Body() body: AcceptInviteDto, @ClientIp() ip: string | null, @Res({ passthrough: true }) res: Response) {
    const result = await this.invites.accept(body, ip);
    setRefreshCookie(res, this.env, result.refreshToken, result.refreshExpiresAt);
    return {
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      user: result.user,
      workspaceSlug: result.workspaceSlug,
    };
  }
}
