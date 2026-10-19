// Synthetic accounts + in-memory PostgreSQL only. Never loads .env or uses SMTP.
require('reflect-metadata');
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/in_memory_test_only';
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { compare, hash } = require('bcryptjs');
const { createHash } = require('node:crypto');
const { database } = require('./pglite-test-adapter.cjs');
const { AccountSecurityService } = require('../dist/auth/account-security.service');
const { AuthRateLimitService, AuthTrafficGuard } = require('../dist/auth/auth-rate-limit.service');
const { AuthService } = require('../dist/auth/auth.service');
const { AuthGuard } = require('../dist/common/auth.guard');
const { MailService } = require('../dist/requests/mail.service');
const { AuthController } = require('../dist/auth/auth.controller');

const oldPassword = 'Synthetic-original!234';
const newPassword = 'Synthetic-replacement!567';
const email = 'existing@example.invalid';
const newEmail = 'replacement@example.invalid';
const adminId = 'synthetic-admin';
let db, prisma, service, limits, guard, auth, config, jwt, mail, sent, originalHash, app, base;
const digest = token => createHash('sha256').update(token).digest('hex');
const dto = () => ({ currentPassword: oldPassword, newPassword, confirmNewPassword: newPassword });
const ctx = token => ({ switchToHttp: () => ({ getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }) }) });
const status = (code, text) => error => { assert.equal(error.getStatus(), code); if (text) assert.match(error.message, text); return true; };
async function requestChange(address = newEmail) {
  await service.requestEmailChange(adminId, { currentPassword: oldPassword, newEmail: address });
  return new URL(sent.at(-1).link).hash.slice('#token='.length);
}

before(async () => {
  const fixture = await database(); db = fixture.db;
  prisma = new PrismaClient({ adapter: fixture.adapter });
  originalHash = await hash(oldPassword, 12);
  config = new ConfigService({ ACCOUNT_FRONTEND_ORIGIN: 'https://store.example.invalid', JWT_SECRET: 'synthetic-test-jwt-secret-never-used-in-production', JWT_EXPIRES_IN: '12h' });
  jwt = new JwtService({ secret: config.get('JWT_SECRET') });
  limits = new AuthRateLimitService(prisma);
  mail = { assertAccountMailConfigured() {}, async sendAccountEmailChange(oldEmail, address, link) { sent.push({ oldEmail, address, link }); } };
  service = new AccountSecurityService(prisma, config, mail, limits);
  auth = new AuthService(prisma, jwt, config, limits);
  guard = new AuthGuard(jwt, prisma);
  const { Module, ValidationPipe } = require('@nestjs/common');
  const { NestFactory } = require('@nestjs/core');
  class TestModule {}
  Module({ controllers: [AuthController], providers: [
    { provide: PrismaServiceToken(), useValue: prisma }, { provide: ConfigService, useValue: config },
    { provide: JwtService, useValue: jwt }, { provide: MailService, useValue: mail },
    AuthService, AuthGuard, AccountSecurityService, AuthRateLimitService, AuthTrafficGuard,
  ] })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, validationError: { target: false, value: false } }));
  await app.listen(0, '127.0.0.1'); base = await app.getUrl();
});
function PrismaServiceToken() { return require('../dist/prisma/prisma.service').PrismaService; }
beforeEach(async () => {
  await db.exec('TRUNCATE "AdminUser", "AuditLog", "AdminSession", "AdminEmailChange", "AuthRateLimit", "Category", "Product" CASCADE');
  await prisma.adminUser.create({ data: { id: adminId, email, passwordHash: originalHash } });
  await prisma.category.create({ data: { id: 'untouched-category', slug: 'untouched', nameEn: 'Keep category', nameFr: 'Keep category' } });
  await prisma.product.create({ data: { id: 'untouched-product', categoryId: 'untouched-category', slug: 'keep-product', nameEn: 'Keep product', nameFr: 'Keep product' } });
  sent = [];
});
after(async () => { if (app) await app.close(); if (prisma) await prisma.$disconnect(); if (db) await db.close(); });

test('password change hashes password, revokes sessions, cancels pending tokens, preserves account and products', async () => {
  const login = await auth.login({ email, password: oldPassword });
  await requestChange();
  const result = await service.changePassword(adminId, dto());
  assert.equal(result.message, 'Your password has been updated successfully. Please log in again.');
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  assert.equal(admin.email, email); assert.equal(admin.credentialVersion, 1);
  assert.equal(await compare(newPassword, admin.passwordHash), true);
  assert.notEqual(admin.passwordHash, newPassword);
  await assert.rejects(guard.canActivate(ctx(login.accessToken)), status(401));
  assert.equal(await prisma.adminEmailChange.count(), 0);
  assert.equal(await prisma.adminUser.count(), 1);
  assert.equal(await prisma.product.count(), 1); assert.equal(await prisma.category.count(), 1);
  await assert.rejects(auth.login({ email, password: oldPassword }), status(401));
  assert.ok((await auth.login({ email, password: newPassword })).accessToken);
});

test('wrong current password does not change credentials or sessions', async () => {
  await assert.rejects(service.changePassword(adminId, { ...dto(), currentPassword: 'incorrect' }), status(400, /Your current password is incorrect/));
  assert.equal((await prisma.adminUser.findUnique({ where: { id: adminId } })).passwordHash, originalHash);
});

test('weak, oversized, mismatched and reused passwords are rejected', async () => {
  for (const password of ['short!1A', 'alllowercaselong123!', 'A!2' + 'é'.repeat(36), oldPassword]) {
    await assert.rejects(service.changePassword(adminId, { ...dto(), newPassword: password, confirmNewPassword: password }), status(400));
  }
  await assert.rejects(service.changePassword(adminId, { ...dto(), confirmNewPassword: 'does-not-match' }), status(400));
  assert.equal((await prisma.adminUser.findUnique({ where: { id: adminId } })).passwordHash, originalHash);
});

test('email request stores only a hash; old email remains active; account status is safe', async () => {
  const token = await requestChange('  Replacement@Example.Invalid  ');
  const pending = await prisma.adminEmailChange.findUnique({ where: { adminId } });
  assert.equal(pending.tokenHash, digest(token)); assert.notEqual(pending.tokenHash, token);
  assert.equal(pending.newEmail, newEmail); assert.equal(sent[0].oldEmail, email);
  assert.match(sent[0].link, /^https:\/\/store.example.invalid\/en\/admin\/verify-email#token=/);
  assert.ok(pending.expiresAt.getTime() - Date.now() <= 20 * 60_000);
  const account = await service.account(adminId);
  assert.equal(account.email, email); assert.equal(account.pendingEmailChange.email, newEmail);
  assert.doesNotMatch(JSON.stringify(account), /tokenHash|passwordHash/);
  assert.ok((await auth.login({ email, password: oldPassword })).accessToken);
  await assert.rejects(auth.login({ email: newEmail, password: oldPassword }), status(401));
});

test('verified email replaces login address, consumes token, revokes sessions and cannot be reused', async () => {
  const login = await auth.login({ email, password: oldPassword });
  const token = await requestChange();
  assert.equal((await service.verifyEmailChange(token)).message, 'Your email address has been updated successfully. Please log in again.');
  assert.equal((await prisma.adminUser.findUnique({ where: { id: adminId } })).email, newEmail);
  assert.equal(await prisma.adminEmailChange.count(), 0);
  await assert.rejects(service.verifyEmailChange(token), status(400, /already been used/));
  await assert.rejects(guard.canActivate(ctx(login.accessToken)), status(401));
  await assert.rejects(auth.login({ email, password: oldPassword }), status(401));
  assert.ok((await auth.login({ email: newEmail, password: oldPassword })).accessToken);
});

test('expired token cannot change login email', async () => {
  const token = await requestChange();
  await prisma.adminEmailChange.update({ where: { adminId }, data: { expiresAt: new Date(Date.now() - 1000) } });
  await assert.rejects(service.verifyEmailChange(token), status(400, /This verification link has expired. Please request a new one./));
  assert.equal((await prisma.adminUser.findUnique({ where: { id: adminId } })).email, email);
});

test('new pending request invalidates older token', async () => {
  const older = await requestChange(); const newer = await requestChange('another@example.invalid');
  await assert.rejects(service.verifyEmailChange(older), status(400));
  await service.verifyEmailChange(newer);
  assert.equal((await prisma.adminUser.findUnique({ where: { id: adminId } })).email, 'another@example.invalid');
});

test('pending token cannot survive password change or credential version mismatch', async () => {
  const token = await requestChange();
  await prisma.adminUser.update({ where: { id: adminId }, data: { credentialVersion: { increment: 1 } } });
  await assert.rejects(service.verifyEmailChange(token), status(400));
  assert.equal((await prisma.adminUser.findUnique({ where: { id: adminId } })).email, email);
});

test('duplicate address rejects request; verification rechecks uniqueness atomically', async () => {
  await prisma.adminUser.create({ data: { email: newEmail, passwordHash: originalHash } });
  await assert.rejects(service.requestEmailChange(adminId, { newEmail, currentPassword: oldPassword }), status(409));
  const token = await requestChange('later@example.invalid');
  await prisma.adminUser.create({ data: { email: 'later@example.invalid', passwordHash: originalHash } });
  await assert.rejects(service.verifyEmailChange(token), status(409));
  assert.equal((await prisma.adminUser.findUnique({ where: { id: adminId } })).email, email);
  assert.equal(await prisma.adminEmailChange.count(), 1); // Transaction rolled back.
});

test('SMTP failure invalidates token, returns no sent claim and preserves existing email', async () => {
  const failingMail = { assertAccountMailConfigured() {}, async sendAccountEmailChange() { throw new Error('private SMTP data'); } };
  const failing = new AccountSecurityService(prisma, config, failingMail, limits);
  await assert.rejects(failing.requestEmailChange(adminId, { newEmail, currentPassword: oldPassword }), status(503, /could not be sent/));
  assert.equal(await prisma.adminEmailChange.count(), 0);
  assert.equal((await prisma.adminUser.findUnique({ where: { id: adminId } })).email, email);
});

test('wrong email-change password or missing mail configuration never creates a pending request', async () => {
  await assert.rejects(service.requestEmailChange(adminId, { newEmail, currentPassword: 'incorrect' }), status(400, /Your current password is incorrect/));
  const { ServiceUnavailableException } = require('@nestjs/common');
  const unavailable = new AccountSecurityService(prisma, config, {
    assertAccountMailConfigured() { throw new ServiceUnavailableException('Account email delivery is not configured.'); },
    async sendAccountEmailChange() { assert.fail('must not send'); },
  }, limits);
  await assert.rejects(unavailable.requestEmailChange(adminId, { newEmail, currentPassword: oldPassword }), status(503, /not configured/));
  assert.equal(await prisma.adminEmailChange.count(), 0); assert.equal(sent.length, 0);
});

test('undelivered or unknown token cannot change email', async () => {
  const token = await requestChange();
  await prisma.adminEmailChange.update({ where: { adminId }, data: { deliveredAt: null } });
  await assert.rejects(service.verifyEmailChange(token), status(400));
  await assert.rejects(service.verifyEmailChange('b'.repeat(64)), status(400));
  assert.equal((await prisma.adminUser.findUnique({ where: { id: adminId } })).email, email);
});

test('account change rolls back password, pending request and session revocations if auditing fails', async () => {
  const login = await auth.login({ email, password: oldPassword });
  await requestChange();
  const failing = new AccountSecurityService({
    adminUser: prisma.adminUser,
    $transaction: callback => prisma.$transaction(tx => callback(new Proxy(tx, { get(target, key) {
      if (key === 'auditLog') return { create: async () => { throw new Error('synthetic audit failure'); } };
      return target[key];
    } }))),
  }, config, mail, limits);
  await assert.rejects(failing.changePassword(adminId, dto()), /synthetic audit failure/);
  const admin = await prisma.adminUser.findUnique({ where: { id: adminId } });
  assert.equal(admin.passwordHash, originalHash); assert.equal(admin.credentialVersion, 0);
  assert.equal(await prisma.adminEmailChange.count(), 1);
  assert.equal(await guard.canActivate(ctx(login.accessToken)), true);
});

test('simultaneous password changes cannot both overwrite the same credential version', async () => {
  const results = await Promise.allSettled([service.changePassword(adminId, dto()), service.changePassword(adminId, dto())]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal((await prisma.adminUser.findUnique({ where: { id: adminId } })).credentialVersion, 1);
});

test('unsafe verification origins fail before sending mail or creating tokens', async () => {
  for (const origin of ['http://store.example.invalid', 'https://store.example.invalid/path', 'https://user:secret@store.example.invalid', 'https://store.example.invalid/?redirect=https://other.invalid']) {
    const unsafe = new AccountSecurityService(prisma, new ConfigService({ ACCOUNT_FRONTEND_ORIGIN: origin }), mail, limits);
    await assert.rejects(unsafe.requestEmailChange(adminId, { newEmail, currentPassword: oldPassword }), status(503));
  }
  assert.equal(sent.length, 0); assert.equal(await prisma.adminEmailChange.count(), 0);
});

test('persistent rate limiting blocks brute-force attempts', async () => {
  for (let i = 0; i < 5; i++) await assert.rejects(service.changePassword(adminId, { ...dto(), currentPassword: 'incorrect' }), status(400));
  await assert.rejects(service.changePassword(adminId, dto()), status(429));
  const anotherInstance = new AuthRateLimitService(prisma);
  await assert.rejects(anotherInstance.consume('account-sensitive', adminId, 5), status(429));
});

test('session created from stale login snapshot after revocation is rejected by credential version', async () => {
  await service.changePassword(adminId, dto());
  const jti = 'stale-login-session';
  await prisma.adminSession.create({ data: { id: jti, adminId, expiresAt: new Date(Date.now() + 60_000), credentialVersion: 0 } });
  const token = await jwt.signAsync({ sub: adminId, email, jti });
  await assert.rejects(guard.canActivate(ctx(token)), status(401));
});

test('simultaneous verification consumes a token at most once', async () => {
  const token = await requestChange();
  const results = await Promise.allSettled([service.verifyEmailChange(token), service.verifyEmailChange(token)]);
  assert.equal(results.filter(value => value.status === 'fulfilled').length, 1);
  assert.equal((await prisma.adminUser.findUnique({ where: { id: adminId } })).credentialVersion, 1);
});

test('real HTTP guards/DTOs, password change and public token verification use existing API prefix', async () => {
  const call = async (path, method = 'GET', body, bearer) => fetch(`${base}/api/v1/admin/auth/${path}`, {
    method, headers: { 'content-type': 'application/json', ...(bearer ? { authorization: `Bearer ${bearer}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  assert.equal((await call('account')).status, 401);
  assert.equal((await call('change-password', 'PATCH', dto())).status, 401);
  assert.equal((await call('email-change/request', 'POST', { newEmail, currentPassword: oldPassword })).status, 401);
  const loginResponse = await call('login', 'POST', { email, password: oldPassword });
  assert.equal(loginResponse.status, 201); const { accessToken } = await loginResponse.json();
  const malformed = await call('email-change/request', 'POST', { newEmail: 'invalid', currentPassword: oldPassword }, accessToken);
  assert.equal(malformed.status, 400);
  assert.equal((await call('change-password', 'PATCH', { ...dto(), newPassword: 'short' }, accessToken)).status, 400);
  assert.equal((await call('email-change/request', 'POST', { newEmail, currentPassword: oldPassword }, accessToken)).status, 201);
  const token = new URL(sent.at(-1).link).hash.slice('#token='.length);
  assert.equal((await call('email-change/verify', 'POST', { token })).status, 201);
  assert.equal((await call('account', 'GET', undefined, accessToken)).status, 401);
  assert.equal((await call('login', 'POST', { email: newEmail, password: oldPassword })).status, 201);
});

test('existing SMTP service sends notification without token and verification only to new email', async () => {
  const envKeys = ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_FROM', 'SMTP_SECURE'];
  const saved = Object.fromEntries(envKeys.map(key => [key, process.env[key]]));
  const nodemailer = require('nodemailer'); const original = nodemailer.createTransport;
  const messages = [];
  try {
    Object.assign(process.env, { SMTP_HOST: 'smtp.example.invalid', SMTP_USER: 'test', SMTP_PASS: 'synthetic-only', SMTP_FROM: 'security@example.invalid', SMTP_SECURE: 'false' });
    nodemailer.createTransport = options => {
      assert.equal(options.requireTLS, true); assert.equal(options.logger, false); assert.equal(options.debug, false);
      return { async sendMail(message) { messages.push(message); return { accepted: [message.to], rejected: [] }; }, close() {} };
    };
    const transport = new MailService(prisma);
    const link = `https://store.example.invalid/en/admin/verify-email#token=${'a'.repeat(64)}`;
    await transport.sendAccountEmailChange(email, newEmail, link);
    assert.equal(messages[0].to, email); assert.doesNotMatch(messages[0].text, /#token=|Synthetic-original/);
    assert.equal(messages[1].to, newEmail); assert.ok(messages[1].text.includes(link));
    delete process.env.SMTP_HOST;
    assert.throws(() => transport.assertAccountMailConfigured(), error => error.getStatus() === 503);
  } finally {
    nodemailer.createTransport = original;
    for (const key of envKeys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  }
});
