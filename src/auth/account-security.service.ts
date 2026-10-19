import { BadRequestException, ConflictException, Injectable, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { compare, hash } from 'bcryptjs';
import { createHash, randomBytes } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../requests/mail.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { ChangePasswordDto, RequestEmailChangeDto } from './account.dto';

const invalidLink = () => new BadRequestException('This verification link is invalid or has already been used.');
const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

@Injectable()
export class AccountSecurityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly mail: MailService,
    private readonly limits: AuthRateLimitService,
  ) {}

  async account(adminId: string) {
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId }, select: { email: true } });
    if (!admin) throw new NotFoundException('Administrator not found.');
    const pending = await this.prisma.adminEmailChange.findUnique({
      where: { adminId }, select: { newEmail: true, expiresAt: true, deliveredAt: true },
    });
    return { email: admin.email, pendingEmailChange: pending?.deliveredAt && pending.expiresAt > new Date()
      ? { email: pending.newEmail, expiresAt: pending.expiresAt } : null };
  }

  private async authenticate(adminId: string, currentPassword: string) {
    await this.limits.consume('account-sensitive', adminId, 5);
    const admin = await this.prisma.adminUser.findUnique({ where: { id: adminId } });
    if (!admin || !(await compare(currentPassword, admin.passwordHash))) {
      throw new BadRequestException('Your current password is incorrect.');
    }
    return admin;
  }

  async changePassword(adminId: string, dto: ChangePasswordDto) {
    const admin = await this.authenticate(adminId, dto.currentPassword);
    if (dto.newPassword !== dto.confirmNewPassword) throw new BadRequestException('The new passwords do not match.');
    if (dto.newPassword.length < 12 || Buffer.byteLength(dto.newPassword, 'utf8') > 72
      || !/[a-z]/.test(dto.newPassword) || !/[A-Z]/.test(dto.newPassword)
      || !/[0-9]/.test(dto.newPassword) || !/[^A-Za-z0-9\s]/.test(dto.newPassword)) {
      throw new BadRequestException('Use at least 12 characters with uppercase, lowercase, a number and a symbol (maximum 72 UTF-8 bytes).');
    }
    if (await compare(dto.newPassword, admin.passwordHash)) throw new BadRequestException('Choose a password different from your current password.');
    const passwordHash = await hash(dto.newPassword, 12);
    await this.prisma.$transaction(async (tx) => {
      const updated = await tx.adminUser.updateMany({
        where: { id: adminId, credentialVersion: admin.credentialVersion, passwordHash: admin.passwordHash },
        data: { passwordHash, credentialVersion: { increment: 1 } },
      });
      if (updated.count !== 1) throw new ConflictException('Your account changed. Please log in again.');
      await tx.adminSession.updateMany({ where: { adminId, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.adminEmailChange.deleteMany({ where: { adminId } });
      await tx.auditLog.create({ data: { adminId, action: 'CHANGE_PASSWORD', entity: 'AdminUser', entityId: adminId, details: {} } });
    });
    return { message: 'Your password has been updated successfully. Please log in again.' };
  }

  private verificationOrigin() {
    try {
      const url = new URL(this.config.get<string>('ACCOUNT_FRONTEND_ORIGIN') || this.config.get<string>('FRONTEND_ORIGIN') || '');
      if (url.protocol !== 'https:' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error();
      return url.origin;
    } catch { throw new ServiceUnavailableException('Account email verification is not configured. Please contact support.'); }
  }

  async requestEmailChange(adminId: string, dto: RequestEmailChangeDto) {
    const admin = await this.authenticate(adminId, dto.currentPassword);
    const newEmail = dto.newEmail.trim().toLowerCase();
    if (newEmail === admin.email.toLowerCase()) throw new BadRequestException('Enter a different email address.');
    if (await this.prisma.adminUser.findUnique({ where: { email: newEmail }, select: { id: true } })) {
      throw new ConflictException('This email address is already in use.');
    }
    const origin = this.verificationOrigin();
    this.mail.assertAccountMailConfigured();
    const token = randomBytes(32).toString('hex');
    const digest = tokenHash(token);
    const expiresAt = new Date(Date.now() + 20 * 60_000);
    const data = { currentEmail: admin.email, newEmail, credentialVersion: admin.credentialVersion, tokenHash: digest, expiresAt, deliveredAt: null };
    await this.prisma.$transaction(async (tx) => {
      // Lock/check the account before replacing its previous pending request.
      const unchanged = await tx.adminUser.updateMany({
        where: { id: adminId, credentialVersion: admin.credentialVersion, passwordHash: admin.passwordHash },
        data: { credentialVersion: { increment: 0 } },
      });
      if (unchanged.count !== 1) throw new ConflictException('Your account changed. Please log in again.');
      await tx.adminEmailChange.upsert({ where: { adminId }, create: { adminId, ...data }, update: data });
    });
    try {
      // Fragment tokens do not appear in HTTP request URLs or Referer headers.
      await this.mail.sendAccountEmailChange(admin.email, newEmail, `${origin}/en/admin/verify-email#token=${token}`);
    } catch {
      await this.prisma.adminEmailChange.deleteMany({ where: { adminId, tokenHash: digest } });
      throw new ServiceUnavailableException('Verification email could not be sent. Your login email has not changed. Please try again later.');
    }
    const delivered = await this.prisma.adminEmailChange.updateMany({
      where: { adminId, tokenHash: digest, expiresAt: { gt: new Date() } }, data: { deliveredAt: new Date() },
    });
    if (delivered.count !== 1) throw new ConflictException('This request was replaced or expired. Please request a new verification link.');
    return { message: 'We have sent a verification link to your new email address.', pendingEmailChange: { email: newEmail, expiresAt } };
  }

  async verifyEmailChange(token: string) {
    const digest = tokenHash(token);
    const pending = await this.prisma.adminEmailChange.findUnique({ where: { tokenHash: digest } });
    if (!pending) throw invalidLink();
    if (pending.expiresAt <= new Date()) throw new BadRequestException('This verification link has expired. Please request a new one.');
    if (!pending.deliveredAt) throw invalidLink();
    try {
      await this.prisma.$transaction(async (tx) => {
        const updated = await tx.adminUser.updateMany({
          where: { id: pending.adminId, email: pending.currentEmail, credentialVersion: pending.credentialVersion },
          data: { email: pending.newEmail, credentialVersion: { increment: 1 } },
        });
        if (updated.count !== 1) throw invalidLink();
        const consumed = await tx.adminEmailChange.deleteMany({
          where: { id: pending.id, tokenHash: digest, expiresAt: { gt: new Date() }, deliveredAt: { not: null } },
        });
        if (consumed.count !== 1) throw invalidLink();
        await tx.adminSession.updateMany({ where: { adminId: pending.adminId, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.auditLog.create({ data: { adminId: pending.adminId, action: 'CHANGE_EMAIL', entity: 'AdminUser', entityId: pending.adminId, details: {} } });
      });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2002') throw new ConflictException('This email address is already in use.');
      throw error;
    }
    return { message: 'Your email address has been updated successfully. Please log in again.' };
  }
}
