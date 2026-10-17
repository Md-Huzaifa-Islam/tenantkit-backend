export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
}

/** Outbound email. Implementations: mock (dev mailbox table) and Resend. */
export abstract class EmailProvider {
  abstract send(message: EmailMessage): Promise<void>;
}
