import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailMessage, EmailProvider } from './email.provider';

/** Stores emails in `dev_emails`; they appear in the web app's /dev/mailbox page. */
@Injectable()
export class MockEmailProvider extends EmailProvider {
  private readonly logger = new Logger(MockEmailProvider.name);

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async send(message: EmailMessage): Promise<void> {
    await this.prisma.devEmail.create({ data: message });
    this.logger.log({ to: message.to, subject: message.subject }, 'Email captured by mock provider');
  }
}
