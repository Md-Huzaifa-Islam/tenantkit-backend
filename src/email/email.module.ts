import { Global, Module } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { EmailProvider } from './email.provider';
import { MockEmailProvider } from './mock-email.provider';
import { ResendEmailProvider } from './resend-email.provider';

@Global()
@Module({
  providers: [
    {
      provide: EmailProvider,
      inject: [ENV, PrismaService],
      useFactory: (env: Env, prisma: PrismaService) =>
        env.emailProvider === 'resend' ? new ResendEmailProvider(env) : new MockEmailProvider(prisma),
    },
  ],
  exports: [EmailProvider],
})
export class EmailModule {}
