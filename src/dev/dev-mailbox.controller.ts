import { CanActivate, Controller, Delete, Get, HttpCode, Inject, Injectable, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { AppException } from '../common/app-exception';
import { Public } from '../common/decorators';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
class DevMailboxEnabledGuard implements CanActivate {
  constructor(@Inject(ENV) private readonly env: Env) {}
  canActivate() {
    if (!this.env.devMailboxEnabled) throw AppException.notFound();
    return true;
  }
}

/**
 * Development-only view of emails captured by the mock email provider. Public so the
 * invite and reset flows can be demoed end to end; disabled unless ENABLE_DEV_MAILBOX.
 */
@ApiTags('dev')
@Public()
@SkipThrottle()
@UseGuards(DevMailboxEnabledGuard)
@Controller('dev/mailbox')
export class DevMailboxController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  list(@Query('to') to?: string) {
    return this.prisma.devEmail.findMany({
      where: to ? { to: { contains: to.toLowerCase() } } : {},
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { id: true, to: true, subject: true, createdAt: true },
    });
  }

  @Get(':id')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const email = await this.prisma.devEmail.findUnique({ where: { id } });
    if (!email) throw AppException.notFound('Email');
    return email;
  }

  @Delete()
  @HttpCode(204)
  async clear() {
    await this.prisma.devEmail.deleteMany({});
  }
}
