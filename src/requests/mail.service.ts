import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

type MailField = { label: string; value: string };

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  constructor(private readonly prisma: PrismaService) {}

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
