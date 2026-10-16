import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'node:crypto';
import { randomUUID } from 'node:crypto';
import { compare, hash } from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { BootstrapDto, LoginDto } from '../common/dto';

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService, private readonly config: ConfigService) {}

  async login(dto: LoginDto) {
    const email = dto.email.trim().toLowerCase();
    const admin = await this.prisma.adminUser.findUnique({ where: { email } });
    if (!admin || !(await compare(dto.password, admin.passwordHash))) throw new UnauthorizedException('Email or password is incorrect.');
    const jti = randomUUID();
    const expiresAt = new Date(Date.now() + this.expiryMilliseconds());
    const accessToken = await this.jwt.signAsync({ sub: admin.id, email: admin.email, jti });
    await this.prisma.adminSession.create({ data: { id: jti, adminId: admin.id, expiresAt } });
    return { accessToken, tokenType: 'Bearer', expiresIn: this.config.get<string>('JWT_EXPIRES_IN') || '12h', admin: { id: admin.id, email: admin.email, name: admin.name } };
  }

  async bootstrap(token: string | undefined, dto: BootstrapDto) {
    const expected = this.config.get<string>('ADMIN_BOOTSTRAP_TOKEN');
    if (!expected || expected.startsWith('replace-') || !token || !this.safeEqual(token, expected)) throw new UnauthorizedException('A valid one-time bootstrap token is required.');
    const passwordHash = await hash(dto.password, 12);
    let admin: Awaited<ReturnType<PrismaService['adminUser']['create']>>;
    try {
      admin = await this.prisma.$transaction(async (tx) => {
        if (await tx.adminUser.count() > 0) throw new ConflictException('Admin bootstrap has already been completed.');
        return tx.adminUser.create({ data: { email: dto.email.trim().toLowerCase(), name: dto.name.trim(), passwordHash } });
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') throw new ConflictException('Admin bootstrap has already been completed.');
      throw error;
    }
    return { admin: { id: admin.id, email: admin.email, name: admin.name }, message: 'Initial administrator created. Remove ADMIN_BOOTSTRAP_TOKEN from the server environment.' };
  }

  async logout(adminId: string, sessionId: string) {
    await this.prisma.adminSession.updateMany({ where: { id: sessionId, adminId, revokedAt: null }, data: { revokedAt: new Date() } });
    return { ok: true };
  }

  private expiryMilliseconds() {
    const value = this.config.get<string>('JWT_EXPIRES_IN') || '12h';
    const match = value.match(/^(\d+)(s|m|h|d)$/i);
    if (!match) return 12 * 60 * 60 * 1000;
    const scale = ({ s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 } as Record<string, number>)[match[2].toLowerCase()];
    return Number(match[1]) * scale;
  }

  private safeEqual(a: string, b: string) {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
