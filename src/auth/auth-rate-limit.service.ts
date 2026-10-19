import { CanActivate, ExecutionContext, HttpException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthRateLimitService {
  constructor(private readonly prisma: PrismaService) {}

  async consume(scope: string, subject: string, limit: number, windowMs = 15 * 60_000) {
    const now = Date.now();
    const bucket = Math.floor(now / windowMs);
    const key = createHash('sha256').update(`${scope}:${subject}:${bucket}`).digest('hex');
    // Atomic increments are shared across processes and survive Render restarts.
    const result = await this.prisma.authRateLimit.upsert({
      where: { key }, create: { key, expiresAt: new Date((bucket + 1) * windowMs) },
      update: { attempts: { increment: 1 } }, select: { attempts: true },
    });
    await this.prisma.authRateLimit.deleteMany({ where: { expiresAt: { lt: new Date(now - windowMs) } } });
    if (result.attempts > limit) throw new HttpException('Too many attempts. Please try again in 15 minutes.', 429);
  }
}

@Injectable()
export class AuthTrafficGuard implements CanActivate {
  constructor(private readonly limits: AuthRateLimitService) {}
  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    // Use the actual peer address, never a caller-controlled forwarded header.
    await this.limits.consume(`auth-traffic:${context.getHandler().name}`, request.ip || 'unknown', 60);
    return true;
  }
}
