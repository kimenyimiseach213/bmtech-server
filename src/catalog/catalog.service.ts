import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async products(status?: string) {
    const rows = await this.prisma.product.findMany({
      where: { isPublished: true, category: { isActive: true } },
      include: { category: true, images: { orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }] } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((row) => this.productView(row));
  }

  async product(slug: string) {
    const row = await this.prisma.product.findFirst({
      where: { slug, isPublished: true, category: { isActive: true } },
      include: { category: true, images: { orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }] } },
    });
    if (!row) throw new NotFoundException('Product not found.');
    return this.productView(row);
  }

  async categories(status?: string) {
    const rows = await this.prisma.category.findMany({
      where: { isActive: true },
      include: { products: { where: { isPublished: true }, select: { id: true } } },
      orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }],
    });
    return rows.map((row) => ({
      id: row.id, slug: row.slug, name: { en: row.nameEn, fr: row.nameFr }, nameEn: row.nameEn, nameFr: row.nameFr,
      descriptionEn: row.descriptionEn, descriptionFr: row.descriptionFr, summary: row.descriptionEn,
      isActive: row.isActive, sortOrder: row.sortOrder, productCount: row.products.length,
    }));
  }

  async publicSettings() {
    const row = await this.prisma.companySettings.findUnique({ where: { id: 'default' } });
    return {
      companyName: row?.companyName || 'BMTECH', phone: row?.phone || '0788494513', whatsapp: row?.whatsapp || '250788494513',
      email: row?.email || '', businessHours: row?.businessHours || '', about: { en: row?.aboutEn || '', fr: row?.aboutFr || '' },
      aboutEn: row?.aboutEn || '', aboutFr: row?.aboutFr || '', ceoWhatsapp: row?.ceoWhatsapp || '', currency: 'RWF',
    };
  }

  async validateCart(items: Array<{ productSlug: string; quantity: number }>) {
    if (!items.length || items.length > 100) throw new BadRequestException('Cart must contain 1 to 100 products.');
    const quantities = new Map<string, number>();
    for (const item of items) {
      if (!Number.isSafeInteger(item.quantity) || item.quantity < 1 || item.quantity > 2147483647) throw new BadRequestException('Invalid quantity.');
      quantities.set(item.productSlug, (quantities.get(item.productSlug) || 0) + item.quantity);
    }
    const products = await this.prisma.product.findMany({
      where: { slug: { in: [...quantities.keys()] }, isPublished: true, category: { isActive: true } },
      include: { category: true, images: { orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }] } },
    });
    const changes: string[] = [];
    const lines: any[] = [];
    for (const [slug, requested] of quantities) {
      const row = products.find(p => p.slug === slug);
      if (!row || !row.isAvailable || row.price === null || row.priceMode !== 'FIXED' || row.stockQuantity < 1) {
        changes.push(`${row?.nameEn || slug} is no longer available and was removed.`); continue;
      }
      const quantity = Math.min(requested, row.stockQuantity);
      if (quantity !== requested) changes.push(`${row.nameEn}: quantity reduced to ${quantity} because stock changed.`);
      lines.push({ product: this.productView(row), quantity });
    }
    const settings = await this.publicSettings();
    return { lines, changes, ceoWhatsapp: settings.ceoWhatsapp, whatsapp: settings.whatsapp, currency: settings.currency };
  }

  private productView(row: any) {
    const images = row.images.map((image: any) => ({ id: image.id, url: image.url, src: image.url, alt: image.alt, sortOrder: image.sortOrder, isCover: image.isCover }));
    return {
      id: row.id, slug: row.slug, sku: row.sku, brand: row.brand, model: row.model,
      isUndersale: row.isUndersale, shortDescription: row.shortDescription, specifications: row.specifications, isAvailable: row.isAvailable,
      name: { en: row.nameEn, fr: row.nameFr }, nameEn: row.nameEn, nameFr: row.nameFr,
      description: { en: row.descriptionEn, fr: row.descriptionFr }, descriptionEn: row.descriptionEn, descriptionFr: row.descriptionFr,
      categoryId: row.categoryId,
      category: { id: row.category.id, slug: row.category.slug, name: row.category.nameEn, nameEn: row.category.nameEn, nameFr: row.category.nameFr },
      condition: row.condition.toLowerCase(), priceMode: row.priceMode.toLowerCase(), price: row.price === null ? null : Number(row.price),
      stockQuantity: row.stockQuantity, installationAvailable: row.installationAvailable, isPublished: row.isPublished,
      images, coverImageUrl: images.find((image: any) => image.isCover)?.url || images[0]?.url || '',
    };
  }
}
