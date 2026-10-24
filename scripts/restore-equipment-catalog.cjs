// Restore the original supplied equipment galleries; existing records are never changed.
// Run from bmtech-backend. Preview by default; pass --apply to create missing records.
require('dotenv').config({ quiet: true });
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const { PrismaService } = require('../dist/prisma/prisma.service');

const source = path.resolve(__dirname, '../../frontend/lib/data.ts');
const loaded = new Module(source, module);
loaded.filename = source;
loaded._compile(ts.transpileModule(fs.readFileSync(source, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, source);
const originals = loaded.exports.products.filter(product =>
  ['generators-for-sale', 'changeover-switches'].includes(product.slug));
const db = new PrismaService();

async function main() {
  if (originals.length !== 2) throw new Error('Expected the two original equipment galleries.');
  // Confirm every original photo is already served by the live frontend before writing.
  for (const product of originals) {
    for (const image of product.images) {
      const response = await fetch(new URL(image.src, 'https://bmtech-iota.vercel.app'), { method: 'HEAD' });
      if (!response.ok || !response.headers.get('content-type')?.startsWith('image/')) {
        throw new Error(`Original equipment photo is unavailable: ${image.src}`);
      }
    }
  }
  const apply = process.argv.includes('--apply');
  const result = await db.$transaction(async tx => {
    const rows = [];
    for (const product of originals) {
      const current = await tx.product.findUnique({ where: { slug: product.slug }, select: { id: true } });
      if (current) { rows.push({ slug: product.slug, action: 'kept-existing' }); continue; }
      if (!apply) { rows.push({ slug: product.slug, action: 'would-create', photos: product.images.length }); continue; }
      const categorySlug = product.category.toLowerCase().replace(/\s+/g, '-');
      const category = await tx.category.upsert({
        where: { slug: categorySlug }, update: {},
        create: { slug: categorySlug, nameEn: product.category, nameFr: product.categoryFr },
      });
      if (!category.isActive) throw new Error(`Category ${categorySlug} is inactive; review it before restoring equipment.`);
      await tx.product.create({ data: {
        slug: product.slug, categoryId: category.id,
        nameEn: product.name.en, nameFr: product.name.fr,
        descriptionEn: product.description.en, descriptionFr: product.description.fr,
        specifications: product.specs, priceMode: 'QUOTE_REQUIRED', price: null,
        stockQuantity: 0, installationAvailable: product.installation,
        isUndersale: false, isPublished: true,
        images: { create: product.images.map((image, index) => ({
          url: image.src, alt: image.alt, sortOrder: index, isCover: index === 0,
        })) },
      } });
      rows.push({ slug: product.slug, action: 'created', photos: product.images.length });
    }
    return rows;
  }, { timeout: 30000 });
  console.log(JSON.stringify(result));
}
main().catch(error => {
  console.error(error.code || error.name, error.message?.replace(/postgres(?:ql)?:\/\/\S+/g, '[database connection]'));
  process.exitCode = 1;
}).finally(() => db.$disconnect());
