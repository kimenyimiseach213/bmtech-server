import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService, private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user?: { sub: string; email: string; jti: string } }>();
    const authorization = request.headers.authorization;
    const token = authorization?.startsWith('Bearer ') ? authorization.slice(7) : '';
    if (!token) throw new UnauthorizedException('Admin authentication is required.');
    let payload: { sub: string; email: string; jti: string };
    try { payload = await this.jwt.verifyAsync<{ sub: string; email: string; jti: string }>(token); }
    catch { throw new UnauthorizedException('Admin session is invalid or expired.'); }
    if (!payload.jti) throw new UnauthorizedException('Admin session is invalid or expired.');
    const session = await this.prisma.adminSession.findUnique({ where: { id: payload.jti }, include: { admin: { select: { credentialVersion: true } } } });
    if (!session || session.adminId !== payload.sub || session.revokedAt || session.expiresAt <= new Date()
      || session.credentialVersion !== session.admin.credentialVersion) throw new UnauthorizedException('Admin session is invalid or expired.');
    request.user = payload;
    return true;
  }
}
