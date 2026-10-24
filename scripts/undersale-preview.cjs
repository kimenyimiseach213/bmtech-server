// Isolated UI test server. No .env, network database, or outgoing email.
require('reflect-metadata');
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/in_memory_test_only';
const express = require('express');
const path = require('node:path');
process.env.UPLOAD_DIRECTORY = path.resolve(__dirname, '../uploads/undersale-preview');
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
const { AdminController } = require('../dist/admin/admin.controller');
const { AdminService } = require('../dist/admin/admin.service');
const { CatalogController } = require('../dist/catalog/catalog.controller');
const { CatalogService } = require('../dist/catalog/catalog.service');
const { MailService } = require('../dist/requests/mail.service');

(async () => {
  if (!process.env.BMTECH_ACCOUNT_PREVIEW_PASSWORD) throw new Error('Set a synthetic BMTECH_ACCOUNT_PREVIEW_PASSWORD for the in-memory preview.');
  const { db, adapter } = await database();
  const prisma = new PrismaClient({ adapter });
  await prisma.adminUser.create({ data: { id: 'preview-admin', email: 'preview@example.invalid', passwordHash: await hash(process.env.BMTECH_ACCOUNT_PREVIEW_PASSWORD, 12) } });
  const config = new ConfigService({ UPLOAD_DIRECTORY: process.env.UPLOAD_DIRECTORY, PUBLIC_API_ORIGIN: 'http://127.0.0.1:3013', ACCOUNT_FRONTEND_ORIGIN: 'https://preview.example.invalid', JWT_EXPIRES_IN: '12h' });
  const jwt = new JwtService({ secret: require('node:crypto').randomBytes(32).toString('hex') });
  class PreviewModule {}
  Module({ controllers: [AuthController, AdminController, CatalogController], providers: [
    { provide: PrismaService, useValue: prisma }, { provide: ConfigService, useValue: config },
    { provide: JwtService, useValue: jwt }, { provide: MailService, useValue: {
      assertAccountMailConfigured() { throw new ServiceUnavailableException('Account email delivery is not configured. Your login email has not changed.'); },
    } }, AdminService, CatalogService, AuthService, AuthGuard, AccountSecurityService, AuthRateLimitService, AuthTrafficGuard,
  ] })(PreviewModule);
  const app = await NestFactory.create(PreviewModule, { logger: false });
  app.use('/uploads', express.static(process.env.UPLOAD_DIRECTORY));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, validationError: { target: false, value: false } }));
  await prisma.companySettings.create({ data: { id: 'default', ceoWhatsapp: '' } });
  for (const [slug, name, photo] of [['generators','Generators','generator-01-enclosed-turquoise.jpeg'],['changeover-switches','Changeover Switches','changeover-01-control-panel.jpeg']]) {
    const c = await prisma.category.create({ data: { slug, nameEn:name, nameFr:name } });
    await prisma.product.create({ data: { categoryId:c.id, slug:'qa-'+slug, nameEn:'QA '+name, nameFr:'QA '+name, priceMode:'QUOTE_REQUIRED', images:{ create:{ url:'/images/products/'+slug+'/'+photo, isCover:true } } } });
  }
  const category = await prisma.category.create({ data: { slug: 'electronics', nameEn: 'Electronics', nameFr: 'Electronics' } });
  const image = 'http://127.0.0.1:3013/preview-photo.svg';
  for (const [index, name] of ['Stereo amplifier', 'Wireless headphones', 'Home audio receiver', 'Portable speaker'].entries()) await prisma.product.create({ data: {
    categoryId: category.id, slug: 'preview-electronics-' + index, nameEn: name, nameFr: name, isUndersale: true,
    shortDescription: 'Synthetic preview product with proportional photography and clear purchase controls.',
    descriptionEn: 'Full preview description. This is isolated test data.', brand: 'Preview', model: 'Model ' + index,
    condition: index === 2 ? 'REFURBISHED' : 'NEW', price: 17500.25 + index * 1000, stockQuantity: index === 3 ? 0 : 3,
    images: { create: [{ url: image, isCover: true }, { url: image + '?photo=2', sortOrder: 1 }] },
  } });
  app.getHttpAdapter().getInstance().get('/preview-photo.svg', (_req, res) => res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" fill="#f2f5f9"/><rect x="100" y="120" width="400" height="160" rx="15" fill="#152c48"/><circle cx="190" cy="200" r="45" fill="#34557a"/><circle cx="410" cy="200" r="45" fill="#34557a"/><circle cx="300" cy="200" r="12" fill="#5196ff"/></svg>'));
  await app.listen(3013, '127.0.0.1');
  console.log('Synthetic in-memory Undersale preview API listening on port 3013. No production access or email delivery.');
  const close = async () => { await app.close(); await prisma.$disconnect(); await db.close(); process.exit(0); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
})();
