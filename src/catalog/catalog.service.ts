import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CatalogService {
  constructor(private readonly prisma: PrismaService) {}

  async products(status?: string) {
    const rows = await this.prisma.product.findMany({
      where: { isPublished: status === 'all' ? undefined : true, category: status === 'all' ? undefined : { isActive: true } },
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
      where: status === 'all' ? undefined : { isActive: true },
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
      aboutEn: row?.aboutEn || '', aboutFr: row?.aboutFr || '',
    };
  }

  private productView(row: any) {
    const images = row.images.map((image: any) => ({ id: image.id, url: image.url, src: image.url, alt: image.alt, sortOrder: image.sortOrder, isCover: image.isCover }));
    return {
      id: row.id, slug: row.slug, sku: row.sku, brand: row.brand, model: row.model,
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
