import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthGuard } from '../common/auth.guard';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AccountSecurityService } from './account-security.service';
import { AuthRateLimitService, AuthTrafficGuard } from './auth-rate-limit.service';
import { MailService } from '../requests/mail.service';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const secret = config.get<string>('JWT_SECRET');
        if (!secret || secret.length < 32) throw new Error('JWT_SECRET must contain at least 32 characters.');
        return { secret, signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') || '12h' } as any };
      },
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService, AuthGuard, AccountSecurityService, AuthRateLimitService, AuthTrafficGuard, MailService],
  exports: [JwtModule, AuthGuard],
})
export class AuthModule {}
