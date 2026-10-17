import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { ClientIp, CurrentUser, SuperAdminOnly } from '../common/decorators';
import type { AuthUser } from '../common/request-context';
import { adminSuspendSchema } from '../shared';
import { AdminService } from './admin.service';

class SuspendDto extends createZodDto(adminSuspendSchema) {}
class ListQueryDto extends createZodDto(
  z.object({
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).optional().default(1),
    pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
  }),
) {}

@ApiTags('admin')
@ApiBearerAuth()
@SuperAdminOnly()
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('workspaces')
  workspaces(@Query() query: ListQueryDto) {
    return this.admin.workspaces(query.q, query.page, query.pageSize);
  }

  @Post('workspaces/:id/suspend')
  @HttpCode(200)
  suspend(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() body: SuspendDto,
    @ClientIp() ip: string | null,
  ) {
    return this.admin.setSuspended(user, id, body.suspended, ip);
  }

  @Post('workspaces/:id/impersonate')
  @HttpCode(200)
  impersonate(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @ClientIp() ip: string | null) {
    return this.admin.impersonate(user, id, ip);
  }

  @Get('metrics')
  metrics() {
    return this.admin.metrics();
  }
}
