import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type MailField = { label: string; value: string };

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly prisma: PrismaService) {}

  assertAccountMailConfigured() {
    if (!process.env.SMTP_HOST || !process.env.SMTP_USER || !process.env.SMTP_PASS || !(process.env.SMTP_FROM || process.env.SMTP_USER)) {
      throw new ServiceUnavailableException('Account email delivery is not configured. Your login email has not changed.');
    }
  }

  async sendAccountEmailChange(currentEmail: string, newEmail: string, verificationLink: string) {
    this.assertAccountMailConfigured();
    const nodemailer = await import('nodemailer');
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST, port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === 'true', requireTLS: true,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000,
      logger: false, debug: false,
    });
    const send = async (to: string, subject: string, text: string) => {
      const result = await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
      if (!Array.isArray(result.accepted) || !result.accepted.some((address: string) => address.toLowerCase() === to.toLowerCase())
        || result.rejected?.length) throw new ServiceUnavailableException('Email delivery was not accepted.');
    };
    try {
      await send(currentEmail, 'BMTECH: email change requested',
        `A change of your BMTECH administrator login email to ${newEmail} was requested. Your current login email remains active until the new address is verified. If you did not request this, change your password immediately from Account & Security.`);
      await send(newEmail, 'Verify your BMTECH administrator email',
        `Confirm this email address for your existing BMTECH administrator account:\n\n${verificationLink}\n\nThis single-use link expires in 20 minutes. If you did not request this change, ignore this email.`);
    } catch {
      // SMTP exceptions may contain recipient addresses or message bodies.
      // Never log/rethrow those exceptions for account verification messages.
      throw new ServiceUnavailableException('Account verification email delivery failed.');
    } finally { transporter.close(); }
  }

  async notifyRequest(kind: string, reference: string, fields: MailField[]) {
    try {
      const configuredEmail = (await this.prisma.companySettings.findUnique({ where: { id: 'default' }, select: { email: true } }))?.email.trim();
      const to = configuredEmail || process.env.BMTECH_NOTIFICATION_EMAIL?.trim();
      if (!to) {
        this.logger.warn(`Email notification for ${reference} skipped: set the public email in Admin > Company settings.`);
        return;
      }

      const host = process.env.SMTP_HOST;
      const user = process.env.SMTP_USER;
      const pass = process.env.SMTP_PASS;
      const from = process.env.SMTP_FROM || user;
      if (!host || !user || !pass || !from) {
        this.logger.warn(`Email notification for ${reference} skipped: configure SMTP_HOST, SMTP_USER, SMTP_PASS and SMTP_FROM.`);
        return;
      }

      const nodemailer = await import('nodemailer');
      const transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_SECURE === 'true',
        auth: { user, pass },
      });
      await transporter.sendMail({
        from,
        to,
        replyTo: fields.find((field) => field.label === 'Customer email')?.value || undefined,
        subject: `BMTECH ${kind} received (${reference})`,
        text: [`A new BMTECH ${kind.toLowerCase()} was submitted.`, `Reference: ${reference}`, '', ...fields.map(({ label, value }) => `${label}: ${value || 'Not provided'}`)].join('\n'),
      });
      this.logger.log(`Email notification sent to ${to} for ${reference}.`);
    } catch (error) {
      this.logger.error(`Email notification failed for ${reference}.`, error instanceof Error ? error.stack : undefined);
    }
  }
}
