// Isolated UI test server. No .env, network database, or outgoing email.
require('reflect-metadata');
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/in_memory_test_only';
const { Module, ValidationPipe, ServiceUnavailableException } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { PrismaClient } = require('@prisma/client');
const { hash } = require('bcryptjs');
const { database } = require('./pglite-test-adapter.cjs');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { AuthController } = require('../dist/auth/auth.controller');
const { AuthService } = require('../dist/auth/auth.service');
const { AccountSecurityService } = require('../dist/auth/account-security.service');
const { AuthGuard } = require('../dist/common/auth.guard');
const { AuthRateLimitService, AuthTrafficGuard } = require('../dist/auth/auth-rate-limit.service');
const { MailService } = require('../dist/requests/mail.service');

(async () => {
  if (!process.env.BMTECH_ACCOUNT_PREVIEW_PASSWORD) throw new Error('Set a synthetic BMTECH_ACCOUNT_PREVIEW_PASSWORD for the in-memory preview.');
  const { db, adapter } = await database();
  const prisma = new PrismaClient({ adapter });
  await prisma.adminUser.create({ data: { id: 'preview-admin', email: 'preview@example.invalid', passwordHash: await hash(process.env.BMTECH_ACCOUNT_PREVIEW_PASSWORD, 12) } });
  const config = new ConfigService({ ACCOUNT_FRONTEND_ORIGIN: 'https://preview.example.invalid', JWT_EXPIRES_IN: '12h' });
  const jwt = new JwtService({ secret: require('node:crypto').randomBytes(32).toString('hex') });
  class PreviewModule {}
  Module({ controllers: [AuthController], providers: [
    { provide: PrismaService, useValue: prisma }, { provide: ConfigService, useValue: config },
    { provide: JwtService, useValue: jwt }, { provide: MailService, useValue: {
      assertAccountMailConfigured() { throw new ServiceUnavailableException('Account email delivery is not configured. Your login email has not changed.'); },
    } }, AuthService, AuthGuard, AccountSecurityService, AuthRateLimitService, AuthTrafficGuard,
  ] })(PreviewModule);
  const app = await NestFactory.create(PreviewModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, validationError: { target: false, value: false } }));
  await app.listen(3011, '127.0.0.1');
  console.log('Synthetic in-memory Account & Security preview API listening on port 3011. No production access or email delivery.');
  const close = async () => { await app.close(); await prisma.$disconnect(); await db.close(); process.exit(0); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
})();
