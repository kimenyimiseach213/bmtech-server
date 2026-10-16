import { Body, Controller, Headers, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { BootstrapDto, LoginDto } from '../common/dto';
import { AuthService } from './auth.service';

@ApiTags('admin-auth')
@Controller('admin/auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('login') login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @UseGuards(AuthGuard)
  @Post('logout') logout(@Req() req: Request & { user: { sub: string; jti: string } }) { return this.auth.logout(req.user.sub, req.user.jti); }
  @Post('bootstrap') bootstrap(@Headers('x-admin-bootstrap-token') token: string, @Body() dto: BootstrapDto) {
    return this.auth.bootstrap(token, dto);
  }
}
