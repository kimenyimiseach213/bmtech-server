import { Body, Controller, Get, Headers, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { BootstrapDto, LoginDto } from '../common/dto';
import { AuthService } from './auth.service';
import { AccountSecurityService } from './account-security.service';
import { ChangePasswordDto, RequestEmailChangeDto, VerifyEmailChangeDto } from './account.dto';
import { AuthTrafficGuard } from './auth-rate-limit.service';

type AdminRequest = Request & { user: { sub: string; jti: string } };

@ApiTags('admin-auth')
@Controller('admin/auth')
export class AuthController {
  constructor(private readonly auth: AuthService, private readonly accountSecurity: AccountSecurityService) {}

  @UseGuards(AuthTrafficGuard)
  @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @UseGuards(AuthGuard)
  @Post('logout') logout(@Req() req: Request & { user: { sub: string; jti: string } }) { return this.auth.logout(req.user.sub, req.user.jti); }
  @UseGuards(AuthGuard)
  @Get('account') account(@Req() req: AdminRequest) { return this.accountSecurity.account(req.user.sub); }
  @UseGuards(AuthGuard, AuthTrafficGuard)
  @Patch('change-password') changePassword(@Req() req: AdminRequest, @Body() dto: ChangePasswordDto) {
    return this.accountSecurity.changePassword(req.user.sub, dto);
  }
  @UseGuards(AuthGuard, AuthTrafficGuard)
  @Post('email-change/request') requestEmailChange(@Req() req: AdminRequest, @Body() dto: RequestEmailChangeDto) {
    return this.accountSecurity.requestEmailChange(req.user.sub, dto);
  }
  @UseGuards(AuthTrafficGuard)
  @Post('email-change/verify') verifyEmailChange(@Body() dto: VerifyEmailChangeDto) {
    return this.accountSecurity.verifyEmailChange(dto.token);
  }
  @UseGuards(AuthTrafficGuard)
  @Post('bootstrap') bootstrap(@Headers('x-admin-bootstrap-token') token: string, @Body() dto: BootstrapDto) {
    return this.auth.bootstrap(token, dto);
  }
}
