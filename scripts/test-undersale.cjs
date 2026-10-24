// Isolated HTTP integration tests over in-memory PostgreSQL. Never loads .env.
require('reflect-metadata');
process.env.DATABASE_URL = 'postgresql://test:test@localhost:1/synthetic';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { PrismaClient } = require('@prisma/client');
const { ConfigService } = require('@nestjs/config');
const { JwtService } = require('@nestjs/jwt');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory } = require('@nestjs/core');
const { database } = require('./pglite-test-adapter.cjs');
const { AdminController } = require('../dist/admin/admin.controller');
const { AdminService } = require('../dist/admin/admin.service');
const { CatalogController } = require('../dist/catalog/catalog.controller');
const { CatalogService } = require('../dist/catalog/catalog.service');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { AuthGuard } = require('../dist/common/auth.guard');
const fs = require('node:fs/promises');
const path = require('node:path');
let app, prisma, db, base, token, product;
const uploadDirectory = path.resolve(__dirname, '../.test-undersale-uploads');
async function req(route, method = 'GET', body, authenticated = true) {
  const headers = {};
  if (authenticated) headers.authorization = `Bearer ${token}`;
  if (body && !(body instanceof FormData)) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + '/api/v1/' + route, { method, headers, body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  return { status: response.status, data };
}
const sale = extra => ({ nameEn: 'Test amplifier', nameFr: 'Test amplificateur', shortDescription: 'Compact stereo amplifier', descriptionEn: 'Full technical description', descriptionFr: 'Description complete', price: 17500.25, priceMode: 'FIXED', condition: 'REFURBISHED', stockQuantity: 3, isUndersale: true, isPublished: false, specifications: [{ label: 'Power', value: '50 W' }], ...extra });
before(async () => {
  const fixture = await database(); db = fixture.db; prisma = new PrismaClient({ adapter: fixture.adapter });
  await prisma.adminUser.create({ data: { id: 'test-admin', email: 'admin@example.invalid', passwordHash: 'synthetic-only' } });
  await prisma.adminSession.create({ data: { id: 'test-session', adminId: 'test-admin', expiresAt: new Date(Date.now() + 3600000) } });
  const jwt = new JwtService({ secret: 'synthetic-local-test-secret' });
  token = await jwt.signAsync({ sub: 'test-admin', jti: 'test-session', email: 'admin@example.invalid' });
  const config = new ConfigService({ UPLOAD_DIRECTORY: uploadDirectory, PUBLIC_API_ORIGIN: 'http://localhost:3001' });
  class TestModule {}
  Module({ controllers: [AdminController, CatalogController], providers: [AdminService, CatalogService, AuthGuard,
    { provide: PrismaService, useValue: prisma }, { provide: ConfigService, useValue: config }, { provide: JwtService, useValue: jwt }] })(TestModule);
  app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1'); base = await app.getUrl();
});
after(async () => {
  await app?.close(); await prisma?.$disconnect(); await db?.close();
  // Only remove known synthetic images from the dedicated test directory.
  for (const file of await fs.readdir(uploadDirectory).catch(() => [])) if (/^[a-f0-9]{32}\.(png|jpg|gif|webp)$/.test(file)) await fs.unlink(path.join(uploadDirectory, file));
});
test('all admin mutations and image endpoints reject anonymous requests', async () => {
  for (const [route, method, body] of [['admin/products', 'POST', sale()], ['admin/products/missing', 'PATCH', { stockQuantity: 3 }], ['admin/products/missing', 'DELETE'], ['admin/products/missing/images', 'POST'], ['admin/settings', 'PATCH', { ceoWhatsapp: '12345678' }]]) assert.equal((await req(route, method, body, false)).status, 401);
});
test('creates one Undersale record in existing Electronics category, validates all fields and hides drafts even with status=all', async () => {
  for (const patch of [{ price: -1 }, { price: 1.001 }, { stockQuantity: 1.5 }, { condition: 'BROKEN' }, { shortDescription: '' }, { specifications: 'invalid' }, { name: { en: 'x'.repeat(201) }, nameEn: undefined }, { isAvailable: 'yes' }]) assert.equal((await req('admin/products', 'POST', sale(patch))).status, 400);
  const result = await req('admin/products', 'POST', sale()); assert.equal(result.status, 201); product = result.data;
  assert.equal(product.category.slug, 'electronics'); assert.equal(product.condition, 'REFURBISHED');
  assert.equal((await req('products?status=all', 'GET', undefined, false)).data.length, 0);
  assert.equal((await req(`products/${product.slug}`, 'GET', undefined, false)).status, 404);
});
test('multiple persistent uploads, bad content/type/size, cover selection, reorder, replacement and removal', async () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=', 'base64');
  async function upload(bytes, mime, count = 1) { const form = new FormData(); for (let i = 0; i < count; i++) form.append('files', new Blob([bytes], { type: mime }), 'photo.png'); return req(`admin/products/${product.id}/images`, 'POST', form); }
  assert.equal((await upload(Buffer.from('not an image'), 'image/png')).status, 400);
  assert.equal((await upload(png, 'image/svg+xml')).status, 400);
  assert.equal((await upload(Buffer.alloc(8388609), 'image/png')).status, 413);
  let result = await upload(png, 'image/png', 2); assert.equal(result.status, 201);
  const images = result.data.data; assert.equal(images.length, 2);
  for (const image of images) assert.deepEqual(await fs.readFile(path.join(uploadDirectory, path.basename(image.url))), png);
  assert.equal((await req(`admin/products/${product.id}/images/reorder`, 'PATCH', { imageIds: [images[1].id, images[0].id], coverImageId: images[1].id })).status, 200);
  let saved = (await req('admin/products')).data.find(p => p.id === product.id); assert.equal(saved.coverImageUrl, images[1].url);
  assert.equal((await req(`admin/products/${product.id}/images/reorder`, 'PATCH', { imageIds: [images[0].id, images[0].id] })).status, 400);
  assert.equal((await req(`admin/products/${product.id}/images/${images[0].id}`, 'DELETE')).status, 200);
  assert.equal((await upload(png, 'image/png')).status, 201);
  saved = (await req('admin/products')).data.find(p => p.id === product.id); assert.equal(saved.images.length, 2);
});
test('publish, edit, CEO preference and business WhatsApp fallback preserve prices without creating orders', async () => {
  assert.equal((await req(`admin/products/${product.id}`, 'PATCH', { isPublished: true })).status, 200);
  let listing = (await req('products', 'GET', undefined, false)).data; assert.equal(listing.length, 1); assert.equal(listing[0].images.length, 2); assert.equal(listing[0].shortDescription, 'Compact stereo amplifier');
  assert.equal((await req('admin/settings', 'PATCH', { ceoWhatsapp: '0788494513' })).status, 400);
  assert.equal((await req('admin/settings', 'PATCH', { whatsapp: '+999 111 12222', ceoWhatsapp: '+999 (123) 45678' })).status, 200);
  assert.equal((await req('settings/public', 'GET', undefined, false)).data.ceoWhatsapp, '99912345678');
  await req(`admin/products/${product.id}`, 'PATCH', { price: 18000.50, stockQuantity: 2 });
  const result = await req('cart/validate', 'POST', { items: [{ productSlug: product.slug, quantity: 2 }, { productSlug: product.slug, quantity: 2 }, { productSlug: 'deleted-product', quantity: 1 }] }, false);
  assert.equal(result.status, 201); assert.equal(result.data.lines.length, 1); assert.equal(result.data.lines[0].quantity, 2); assert.equal(result.data.lines[0].product.price, 18000.5); assert.equal(result.data.changes.length, 2);
  assert.equal(result.data.ceoWhatsapp, '99912345678'); assert.equal(result.data.whatsapp, '+999 111 12222');
  await req('admin/settings', 'PATCH', { ceoWhatsapp: '' });
  const fallback = await req('cart/validate', 'POST', { items: [{ productSlug: product.slug, quantity: 1 }] }, false);
  assert.equal(fallback.data.ceoWhatsapp, ''); assert.equal(fallback.data.whatsapp, '+999 111 12222');
  assert.equal(await prisma.order.count(), 0); assert.equal(await prisma.payment.count(), 0); assert.equal((await prisma.product.findUnique({ where: { id: product.id } })).stockQuantity, 2);
});
test('sold out, unavailable, unpublished, inactive categories and deleted products cannot be ordered', async () => {
  const validate = () => req('cart/validate', 'POST', { items: [{ productSlug: product.slug, quantity: 1 }] }, false);
  for (const update of [{ stockQuantity: 0 }, { stockQuantity: 3, isAvailable: false }, { isAvailable: true, isPublished: false }]) {
    await req(`admin/products/${product.id}`, 'PATCH', update); const result = await validate(); assert.equal(result.data.lines.length, 0); assert.equal(result.data.changes.length, 1);
  }
  assert.equal((await req('products?status=all', 'GET', undefined, false)).data.length, 0);
  await req(`admin/products/${product.id}`, 'PATCH', { isPublished: true });
  await prisma.category.update({ where: { id: product.categoryId }, data: { isActive: false } });
  assert.equal((await req('products?status=all', 'GET', undefined, false)).data.length, 0); assert.equal((await validate()).data.lines.length, 0);
  assert.equal((await req(`admin/products/${product.id}`, 'DELETE')).status, 200);
  assert.equal((await validate()).data.lines.length, 0); assert.equal(await prisma.productImage.count(), 0);
});
test('cart validation rejects invalid quantities and excessive input', async () => {
  for (const items of [[], [{ productSlug: 'x', quantity: 0 }], [{ productSlug: 'x', quantity: 1.5 }], Array.from({ length: 101 }, () => ({ productSlug: 'x', quantity: 1 }))]) assert.equal((await req('cart/validate', 'POST', { items }, false)).status, 400);
});

test('published Undersale requires saved photos and its final published photo cannot be removed', async () => {
  const created = await req('admin/products','POST',sale({ nameEn:'Photo publication test',nameFr:'Photo publication test' }));
  assert.equal(created.status,201);
  const id=created.data.id;
  assert.equal((await req(`admin/products/${id}`,'PATCH',{isPublished:true})).status,400);
  const form=new FormData();form.append('files',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'photo.png');
  const uploaded=await req(`admin/products/${id}/images`,'POST',form);assert.equal(uploaded.status,201);
  assert.equal((await req(`admin/products/${id}`,'PATCH',{isPublished:true})).status,200);
  assert.equal((await req(`admin/products/${id}/images/${uploaded.data.data[0].id}`,'DELETE')).status,400);
  await req(`admin/products/${id}`,'PATCH',{isPublished:false});
  assert.equal((await req(`admin/products/${id}/images/${uploaded.data.data[0].id}`,'DELETE')).status,200);
  await req(`admin/products/${id}`,'DELETE');
});
test('production uploads reject ephemeral disk storage without persistent configuration', async () => {
  const beforeNode=process.env.NODE_ENV, beforePersistent=process.env.PERSISTENT_UPLOADS, beforeBlob=process.env.BLOB_READ_WRITE_TOKEN;
  const created=await req('admin/products','POST',sale({nameEn:'Storage safety test',nameFr:'Storage safety test'}));
  process.env.NODE_ENV='production';delete process.env.PERSISTENT_UPLOADS;delete process.env.BLOB_READ_WRITE_TOKEN;
  try {
    const form=new FormData();form.append('files',new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jWZkAAAAASUVORK5CYII=','base64')],{type:'image/png'}),'photo.png');
    const result=await req(`admin/products/${created.data.id}/images`,'POST',form);
    assert.equal(result.status,400);assert.match(result.data.message,/durable|BLOB_READ_WRITE_TOKEN/);
    assert.equal(await prisma.productImage.count({where:{productId:created.data.id}}),0);
  } finally {
    for (const [key,value] of [['NODE_ENV',beforeNode],['PERSISTENT_UPLOADS',beforePersistent],['BLOB_READ_WRITE_TOKEN',beforeBlob]]) if(value===undefined)delete process.env[key];else process.env[key]=value;
    await req(`admin/products/${created.data.id}`,'DELETE');
  }
});
