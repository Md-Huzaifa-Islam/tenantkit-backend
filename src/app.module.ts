import { randomUUID } from 'node:crypto';
import { Module, RequestMethod } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { ZodValidationPipe } from 'nestjs-zod';
import { AdminModule } from './admin/admin.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { BillingModule } from './billing/billing.module';
import { HttpExceptionFilter } from './common/http-exception.filter';
import { DevModule } from './dev/dev.module';
import { EmailModule } from './email/email.module';
import { MembersModule } from './members/members.module';
import { ProjectsModule } from './projects/projects.module';
import { StorageModule } from './storage/storage.module';
import { WorkspacesModule } from './workspaces/workspaces.module';
import { ConfigModule } from './config/config.module';
import { env } from './config/env';
import { HealthController } from './health/health.controller';
import { PrismaModule } from './prisma/prisma.module';

@Module({
  imports: [
    ConfigModule,
    LoggerModule.forRoot({
      forRoutes: [{ path: '{*path}', method: RequestMethod.ALL }],
      pinoHttp: {
        level: env().LOG_LEVEL,
        genReqId: (req, res) => {
          const incoming = req.headers['x-request-id'];
          const id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
          res.setHeader('x-request-id', id);
          return id;
        },
        redact: {
          paths: [
            'req.headers.authorization',
            'req.headers.cookie',
            'res.headers["set-cookie"]',
            '*.password',
            '*.token',
          ],
          censor: '[redacted]',
        },
        customProps: () => ({ service: 'tenantkit-api' }),
        autoLogging: { ignore: (req) => req.url?.startsWith('/api/v1/health') ?? false },
        transport:
          env().NODE_ENV === 'development'
            ? { target: 'pino-pretty', options: { singleLine: true } }
            : undefined,
      },
    }),
    // Default throttle is generous; auth routes override it with a strict limit.
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60_000, limit: 600 }]),
    PrismaModule,
    EmailModule,
    AuditModule,
    AuthModule,
    StorageModule,
    WorkspacesModule,
    MembersModule,
    ProjectsModule,
    BillingModule,
    AdminModule,
    DevModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_PIPE, useClass: ZodValidationPipe },
    { provide: APP_FILTER, useClass: HttpExceptionFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
