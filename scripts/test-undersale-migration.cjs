const { test } = require('node:test');
const assert = require('node:assert/strict');
const { PGlite } = require('@electric-sql/pglite');
const fs = require('node:fs');
const path = require('node:path');

test('additive Undersale migration preserves historical products, photos, stock and company contacts', async () => {
  const db = new PGlite();
  const root = path.resolve(__dirname,'../prisma/migrations');
  try {
    for (const migration of ['20261013000000_init','20261018000000_account_security']) await db.exec(fs.readFileSync(path.join(root,migration,'migration.sql'),'utf8'));
    await db.exec(`INSERT INTO "Category" (id,slug,"nameEn","nameFr","updatedAt") VALUES ('historical-category','generators','Generators','Generators',CURRENT_TIMESTAMP);
      INSERT INTO "Product" (id,slug,"categoryId","nameEn","nameFr",price,"stockQuantity","isPublished",condition,"updatedAt") VALUES ('historical-product','historical-generator','historical-category','Keep original name','Keep original name',123.45,7,false,'USED',CURRENT_TIMESTAMP);
      INSERT INTO "ProductImage" (id,"productId",url,"isCover") VALUES ('historical-image','historical-product','https://old.example.invalid/uploads/original.jpg',true);
      INSERT INTO "CompanySettings" (id,"companyName",phone,whatsapp,"updatedAt") VALUES ('default','Historical business','original phone','original WhatsApp',CURRENT_TIMESTAMP);`);
    await db.exec(fs.readFileSync(path.join(root,'20261021000000_undersale','migration.sql'),'utf8'));
    const {rows:[product]}=await db.query('SELECT * FROM "Product" WHERE id=$1',['historical-product']);
    assert.equal(product.nameEn,'Keep original name'); assert.equal(Number(product.price),123.45);assert.equal(product.stockQuantity,7);assert.equal(product.isPublished,false);assert.equal(product.condition,'USED');
    assert.equal(product.isUndersale,false);assert.equal(product.isAvailable,true);assert.equal(product.shortDescription,'');assert.deepEqual(product.specifications,[]);
    const {rows:[company]}=await db.query('SELECT * FROM "CompanySettings"');assert.equal(company.whatsapp,'original WhatsApp');assert.equal(company.phone,'original phone');assert.equal(company.ceoWhatsapp,'');
    const {rows:[image]}=await db.query('SELECT * FROM "ProductImage"');assert.equal(image.url,'https://old.example.invalid/uploads/original.jpg');assert.equal(image.isCover,true);
  } finally { await db.close(); }
});
