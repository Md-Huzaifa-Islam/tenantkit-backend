import { Inject, Injectable, Logger } from '@nestjs/common';
import { ENV, type Env } from '../config/env';
import { EmailMessage, EmailProvider } from './email.provider';

/** Sends through the Resend HTTP API (https://resend.com/docs/api-reference/emails/send-email). */
@Injectable()
export class ResendEmailProvider extends EmailProvider {
  private readonly logger = new Logger(ResendEmailProvider.name);

  constructor(@Inject(ENV) private readonly env: Env) {
    super();
  }

  async send(message: EmailMessage): Promise<void> {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ from: this.env.EMAIL_FROM, ...message }),
    });
    if (!res.ok) {
      const body = await res.text();
      this.logger.error({ status: res.status, body }, 'Resend rejected email');
      throw new Error(`Email delivery failed with status ${res.status}`);
    }
  }
}
