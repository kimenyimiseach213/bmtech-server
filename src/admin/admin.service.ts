import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { del, put } from '@vercel/blob';
import { unlink } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { AdminRecordDto, ImageReorderDto } from '../common/dto';
import { PrismaService } from '../prisma/prisma.service';

const slugify = (value: string) => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || `item-${Date.now()}`;
const isUniqueError = (error: unknown) => error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

@Injectable()
export class AdminService {
  constructor(private readonly prisma: PrismaService, private readonly config: ConfigService) {}

  async summary() {
    const [pendingOrders, unverifiedPayments, openQuotations, pendingBookings, unreadMessages] = await Promise.all([
      this.prisma.order.count({ where: { status: 'PENDING' } }),
      this.prisma.payment.count({ where: { status: 'UNVERIFIED' } }),
      this.prisma.quotationRequest.count({ where: { status: { in: ['OPEN', 'IN_REVIEW'] } } }),
      this.prisma.technicianBooking.count({ where: { status: 'PENDING' } }),
      this.prisma.contactMessage.count({ where: { status: 'UNREAD' } }),
    ]);
    return { pendingOrders, unverifiedPayments, openQuotations, pendingBookings, unreadMessages };
  }

  async list(resource: string, search?: string): Promise<any[]> {
    const term = search?.trim();
    switch (resource) {
      case 'products': return this.prisma.product.findMany({ where: term ? { OR: [{ nameEn: { contains: term, mode: 'insensitive' } }, { nameFr: { contains: term, mode: 'insensitive' } }, { sku: { contains: term, mode: 'insensitive' } }] } : undefined, include: { category: true, images: { orderBy: [{ isCover: 'desc' }, { sortOrder: 'asc' }] } }, orderBy: { createdAt: 'desc' } }).then((rows) => rows.map((row) => this.productView(row)));
      case 'categories': return this.prisma.category.findMany({ include: { _count: { select: { products: true } } }, orderBy: [{ sortOrder: 'asc' }, { nameEn: 'asc' }] }).then((rows) => rows.map((row) => ({ ...row, name: { en: row.nameEn, fr: row.nameFr }, productCount: row._count.products })));
      case 'orders': return this.prisma.order.findMany({ where: term ? { OR: [{ reference: { contains: term, mode: 'insensitive' } }, { customerName: { contains: term, mode: 'insensitive' } }, { customerPhone: { contains: term } }] } : undefined, include: { items: true, payment: true }, orderBy: { createdAt: 'desc' } }).then((rows) => rows.map((row) => ({ ...row, orderId: row.id, total: Number(row.total), customer: { name: row.customerName, phone: row.customerPhone, email: row.customerEmail }, fulfillment: row.fulfillment.toLowerCase(), items: row.items.map((item) => ({ ...item, unitPrice: Number(item.unitPrice), lineTotal: Number(item.lineTotal) })) })));
      case 'payments': return this.prisma.payment.findMany({ include: { order: { select: { id: true, reference: true, customerName: true, customerPhone: true } } }, orderBy: { createdAt: 'desc' } }).then((rows) => rows.map((row) => ({ ...row, amount: Number(row.amount), reference: row.order.reference, orderId: row.orderId, order: { id: row.order.id, reference: row.order.reference, customer: { name: row.order.customerName, phone: row.order.customerPhone } } })));
      case 'quotation-requests': return this.prisma.quotationRequest.findMany({ orderBy: { createdAt: 'desc' } }).then((rows) => rows.map((row) => ({ ...row, selection: row.productOrService, customer: { name: row.name, phone: row.phone, email: row.email }, quotedAmount: row.quotedAmount === null ? null : Number(row.quotedAmount) })));
      case 'technician-bookings': return this.prisma.technicianBooking.findMany({ orderBy: { preferredDate: 'asc' } }).then((rows) => rows.map((row) => ({ ...row, customer: { name: row.name, phone: row.phone, email: row.email } })));
      case 'contact-messages': return this.prisma.contactMessage.findMany({ orderBy: { createdAt: 'desc' } }).then((rows) => rows.map((row) => ({ ...row, customer: { name: row.name, phone: row.phone, email: row.email } })));
      case 'reviews': return this.prisma.review.findMany({ orderBy: { createdAt: 'desc' } });
      default: throw new NotFoundException(`Unknown admin resource: ${resource}.`);
    }
  }

  async settings() {
    const row = await this.prisma.companySettings.findUnique({ where: { id: 'default' } }) || {
      id: 'default', companyName: 'BMTECH', phone: '0788494513', whatsapp: '250788494513', email: '', businessHours: '', aboutEn: '', aboutFr: '', updatedAt: null,
    };
    return { data: row };
  }

  async create(resource: string, body: AdminRecordDto, adminId: string) {
    const data = body as Record<string, any>;
    try {
      if (resource === 'products') {
        const names = this.names(data, 'name');
        const descriptions = this.names(data, 'description');
        const slug = slugify(String(data.slug || names.en));
        if (!names.en || !names.fr) throw new BadRequestException('Product names in English and French are required.');
        if (!data.categoryId) throw new BadRequestException('Choose a product category.');
        const priceMode = this.enumValue(data.priceMode, ['FIXED', 'QUOTE_REQUIRED'], 'FIXED');
        const product = await this.prisma.product.create({ data: {
          slug, sku: data.sku || null, categoryId: String(data.categoryId), brand: String(data.brand || ''), model: String(data.model || ''),
          nameEn: names.en, nameFr: names.fr, descriptionEn: descriptions.en, descriptionFr: descriptions.fr,
          condition: this.enumValue(data.condition, ['NEW', 'USED'], 'NEW'), priceMode,
          price: priceMode === 'QUOTE_REQUIRED' ? null : this.money(data.price, true),
          stockQuantity: this.integer(data.stockQuantity ?? 0, 'Stock quantity'), installationAvailable: this.boolean(data.installationAvailable, false), isPublished: this.boolean(data.isPublished, true),
        }, include: { category: true, images: true } });
        await this.audit(adminId, 'CREATE', 'Product', product.id, { slug: product.slug });
        return this.productView(product);
      }
      if (resource === 'categories') {
        const names = this.names(data, 'name');
        if (!names.en || !names.fr) throw new BadRequestException('Category names in English and French are required.');
        const category = await this.prisma.category.create({ data: {
          slug: slugify(String(data.slug || names.en)), nameEn: names.en, nameFr: names.fr,
          descriptionEn: this.text(data.descriptionEn ?? this.names(data, 'description').en), descriptionFr: this.text(data.descriptionFr ?? this.names(data, 'description').fr),
          sortOrder: this.integer(data.sortOrder ?? 0, 'Display order'), isActive: this.boolean(data.isActive, true),
        } });
        await this.audit(adminId, 'CREATE', 'Category', category.id, { slug: category.slug });
        return { ...category, name: { en: category.nameEn, fr: category.nameFr } };
      }
      throw new BadRequestException(`Creating records in ${resource} is not supported.`);
    } catch (error) { this.rethrow(error); }
  }

  async update(resource: string, id: string, body: AdminRecordDto, adminId: string) {
    const data = body as Record<string, any>;
    try {
      let result: any;
      if (resource === 'products') {
        const current = await this.prisma.product.findUnique({ where: { id }, include: { category: true, images: true } });
        if (!current) throw new NotFoundException('Product not found.');
        const names = this.names(data, 'name', current.nameEn, current.nameFr);
        const descriptions = this.names(data, 'description', current.descriptionEn, current.descriptionFr);
        const mode = data.priceMode === undefined ? current.priceMode : this.enumValue(data.priceMode, ['FIXED', 'QUOTE_REQUIRED'], current.priceMode);
        if (!names.en || !names.fr) throw new BadRequestException('Product names in English and French are required.');
        result = await this.prisma.product.update({ where: { id }, data: {
          slug: data.slug === undefined ? undefined : slugify(String(data.slug)), sku: data.sku === undefined ? undefined : data.sku || null,
          categoryId: data.categoryId === undefined ? undefined : String(data.categoryId), brand: data.brand === undefined ? undefined : String(data.brand),
          model: data.model === undefined ? undefined : String(data.model), nameEn: names.en, nameFr: names.fr,
          descriptionEn: descriptions.en, descriptionFr: descriptions.fr,
          condition: data.condition === undefined ? undefined : this.enumValue(data.condition, ['NEW', 'USED'], current.condition), priceMode: mode,
          price: mode === 'QUOTE_REQUIRED' ? null : data.price === undefined ? current.price === null ? this.money(undefined, true) : undefined : this.money(data.price, true),
          stockQuantity: data.stockQuantity === undefined ? undefined : this.integer(data.stockQuantity, 'Stock quantity'),
          installationAvailable: data.installationAvailable === undefined ? undefined : this.boolean(data.installationAvailable, false),
          isPublished: data.isPublished === undefined ? undefined : this.boolean(data.isPublished, false),
        }, include: { category: true, images: true } });
        result = this.productView(result);
      } else if (resource === 'categories') {
        const current = await this.prisma.category.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Category not found.');
        const names = this.names(data, 'name', current.nameEn, current.nameFr);
        const descriptions = this.names(data, 'description', current.descriptionEn, current.descriptionFr);
        if (!names.en || !names.fr) throw new BadRequestException('Category names in English and French are required.');
        const category = await this.prisma.category.update({ where: { id }, data: {
          slug: data.slug === undefined ? undefined : slugify(String(data.slug)), nameEn: names.en, nameFr: names.fr,
          descriptionEn: descriptions.en, descriptionFr: descriptions.fr, sortOrder: data.sortOrder === undefined ? undefined : this.integer(data.sortOrder, 'Display order'),
          isActive: data.isActive === undefined ? undefined : this.boolean(data.isActive, false),
        } });
        result = { ...category, name: { en: category.nameEn, fr: category.nameFr } };
      } else if (resource === 'orders') {
        const status = this.enumValue(data.status, ['PENDING', 'CONFIRMED', 'PROCESSING', 'FULFILLED', 'CANCELLED'], 'PENDING');
        result = await this.prisma.order.update({ where: { id }, data: { status } });
      } else if (resource === 'quotation-requests') {
        result = await this.prisma.quotationRequest.update({ where: { id }, data: {
          status: data.status === undefined ? undefined : this.enumValue(data.status, ['OPEN', 'IN_REVIEW', 'QUOTED', 'ACCEPTED', 'REJECTED', 'CLOSED'], 'OPEN'),
          quotedAmount: data.quotedAmount === undefined ? undefined : data.quotedAmount === null || data.quotedAmount === '' ? null : this.money(data.quotedAmount, true),
          adminNotes: data.adminNotes === undefined ? undefined : String(data.adminNotes),
        } });
        result = { ...result, selection: result.productOrService, customer: { name: result.name, phone: result.phone, email: result.email }, quotedAmount: result.quotedAmount === null ? null : Number(result.quotedAmount) };
      } else if (resource === 'technician-bookings') {
        const scheduledAt = data.scheduledAt ? new Date(String(data.scheduledAt)) : null;
        if (scheduledAt && !Number.isFinite(scheduledAt.getTime())) throw new BadRequestException('Scheduled date and time are invalid.');
        result = await this.prisma.technicianBooking.update({ where: { id }, data: {
          status: data.status === undefined ? undefined : this.enumValue(data.status, ['PENDING', 'APPROVED', 'RESCHEDULED', 'REJECTED', 'COMPLETED'], 'PENDING'),
          scheduledAt: data.scheduledAt === undefined ? undefined : scheduledAt,
          adminNotes: data.adminNotes === undefined ? undefined : String(data.adminNotes),
        } });
        result = { ...result, customer: { name: result.name, phone: result.phone, email: result.email } };
      } else if (resource === 'contact-messages') {
        result = await this.prisma.contactMessage.update({ where: { id }, data: {
          status: data.status === undefined ? undefined : this.enumValue(data.status, ['UNREAD', 'READ', 'HANDLED'], 'UNREAD'),
          adminNotes: data.adminNotes === undefined ? undefined : String(data.adminNotes),
        } });
        result = { ...result, customer: { name: result.name, phone: result.phone, email: result.email } };
      } else if (resource === 'reviews') {
        result = await this.prisma.review.update({ where: { id }, data: {
          status: data.status === undefined ? undefined : this.enumValue(data.status, ['PENDING', 'APPROVED', 'HIDDEN'], 'PENDING'),
          adminNotes: data.adminNotes === undefined ? undefined : String(data.adminNotes),
        } });
      } else throw new BadRequestException(`Updating records in ${resource} is not supported.`);
      await this.audit(adminId, 'UPDATE', this.entity(resource), id, data);
      return result;
    } catch (error) { this.rethrow(error); }
  }

  async updateSettings(body: AdminRecordDto, adminId: string) {
    const data = body as Record<string, any>;
    const result = await this.prisma.companySettings.upsert({ where: { id: 'default' }, create: {
      id: 'default', companyName: this.text(data.companyName, 'BMTECH'), phone: this.text(data.phone, '0788494513'), whatsapp: this.text(data.whatsapp, '250788494513'),
      email: this.text(data.email), businessHours: this.text(data.businessHours), aboutEn: this.text(data.aboutEn), aboutFr: this.text(data.aboutFr),
    }, update: Object.fromEntries(['companyName', 'phone', 'whatsapp', 'email', 'businessHours', 'aboutEn', 'aboutFr'].filter((key) => data[key] !== undefined).map((key) => [key, String(data[key])])) });
    await this.audit(adminId, 'UPDATE', 'CompanySettings', result.id, data);
    return { data: result };
  }

  async reorderCategory(id: string, sortOrder: number, adminId: string) {
    const result = await this.prisma.category.update({ where: { id }, data: { sortOrder } });
    await this.audit(adminId, 'REORDER', 'Category', id, { sortOrder });
    return result;
  }

  async verifyOrderPayment(orderId: string, adminId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { orderId } });
    if (!payment) throw new NotFoundException('Payment record not found for this order.');
    return this.verifyPayment(payment.id, adminId);
  }

  async verifyPayment(paymentId: string, adminId: string) {
    const payment = await this.prisma.payment.findUnique({ where: { id: paymentId }, include: { order: true } });
    if (!payment) throw new NotFoundException('Payment not found.');
    if (payment.status !== 'UNVERIFIED') throw new BadRequestException('Only unverified payments can be manually verified.');
    const updated = await this.prisma.$transaction(async (tx) => {
      const saved = await tx.payment.update({ where: { id: paymentId }, data: { status: 'VERIFIED', verifiedAt: new Date() } });
      await tx.order.update({ where: { id: payment.orderId }, data: { paymentStatus: 'VERIFIED' } });
      await tx.auditLog.create({ data: { adminId, action: 'VERIFY_PAYMENT', entity: 'Payment', entityId: paymentId, details: { orderId: payment.orderId, orderReference: payment.order.reference, amount: Number(payment.amount) } } });
      return saved;
    });
    return { ...updated, amount: Number(updated.amount), orderId: payment.orderId, order: { id: payment.order.id, reference: payment.order.reference } };
  }

  async remove(resource: string, id: string, adminId: string) {
    let entity: string;
    if (resource === 'products') { await this.prisma.product.delete({ where: { id } }); entity = 'Product'; }
    else if (resource === 'categories') { await this.prisma.category.delete({ where: { id } }); entity = 'Category'; }
    else if (resource === 'reviews') { await this.prisma.review.delete({ where: { id } }); entity = 'Review'; }
    else throw new BadRequestException(`Deleting records from ${resource} is not supported.`);
    await this.audit(adminId, 'DELETE', entity, id, {});
    return { ok: true, id };
  }

  async addImages(productId: string, files: Express.Multer.File[], adminId: string) {
    if (!files.length) throw new BadRequestException('Select at least one image.');
    const product = await this.prisma.product.findUnique({ where: { id: productId }, include: { images: true } });
    if (!product) throw new NotFoundException('Product not found.');
    const origin = (this.config.get<string>('PUBLIC_API_ORIGIN') || 'http://localhost:3001').replace(/\/$/, '');
    const blobToken = process.env.BLOB_READ_WRITE_TOKEN;
    const uploaded = blobToken ? await Promise.all(files.map(async (file) => {
      const extension = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' } as Record<string, string>)[file.mimetype] || '.img';
      const blob = await put(`products/${Date.now()}-${Math.random().toString(36).slice(2)}${extension}`, file.buffer, { access: 'public', token: blobToken });
      return blob.url;
    })) : files.map((file) => `${origin}/uploads/${encodeURIComponent(file.filename)}`);
    const created = await this.prisma.$transaction(files.map((file, index) => this.prisma.productImage.create({ data: {
      productId, url: uploaded[index], alt: product.nameEn,
      sortOrder: product.images.length + index, isCover: product.images.length === 0 && index === 0,
    } })));
    await this.audit(adminId, 'UPLOAD_IMAGES', 'Product', productId, { imageIds: created.map((image) => image.id) });
    return { data: created };
  }

  async deleteImage(productId: string, imageId: string, adminId: string) {
    const image = await this.prisma.productImage.findFirst({ where: { id: imageId, productId } });
    if (!image) throw new NotFoundException('Product image not found.');
    await this.prisma.productImage.delete({ where: { id: imageId } });
    if (image.url.includes('.public.blob.vercel-storage.com/')) {
      try { await del(image.url, { token: process.env.BLOB_READ_WRITE_TOKEN }); } catch { /* The database record has already been removed. */ }
    } else if (image.url.includes('/uploads/')) {
      const file = resolve(process.cwd(), process.env.UPLOAD_DIRECTORY || './uploads', basename(decodeURIComponent(new URL(image.url).pathname)));
      try { await unlink(file); } catch { /* The database record has already been removed. */ }
    }
    const remaining = await this.prisma.productImage.findMany({ where: { productId }, orderBy: { sortOrder: 'asc' } });
    if (remaining.length && !remaining.some((row) => row.isCover)) await this.prisma.productImage.update({ where: { id: remaining[0].id }, data: { isCover: true } });
    await this.audit(adminId, 'DELETE_IMAGE', 'Product', productId, { imageId });
    return { ok: true };
  }

  async reorderImages(productId: string, dto: ImageReorderDto, adminId: string) {
    const images = await this.prisma.productImage.findMany({ where: { productId }, select: { id: true } });
    const currentIds = new Set(images.map((image) => image.id));
    if (dto.imageIds.length !== currentIds.size || new Set(dto.imageIds).size !== currentIds.size || dto.imageIds.some((id) => !currentIds.has(id))) throw new BadRequestException('Image order must include every product image exactly once.');
    if (dto.coverImageId && !currentIds.has(dto.coverImageId)) throw new BadRequestException('Cover image must belong to this product.');
    await this.prisma.$transaction(dto.imageIds.map((id, sortOrder) => this.prisma.productImage.update({ where: { id }, data: { sortOrder, isCover: id === (dto.coverImageId || dto.imageIds[0]) } })));
    await this.audit(adminId, 'REORDER_IMAGES', 'Product', productId, dto as any);
    return { ok: true };
  }

  private async audit(adminId: string, action: string, entity: string, entityId: string, details: unknown) {
    await this.prisma.auditLog.create({ data: { adminId, action, entity, entityId, details: details as Prisma.InputJsonValue } });
  }
  private names(data: Record<string, any>, key: 'name' | 'description', fallbackEn = '', fallbackFr = '') {
    const nested = data[key] && typeof data[key] === 'object' ? data[key] : {};
    return { en: this.text(data[`${key}En`] ?? nested.en, fallbackEn), fr: this.text(data[`${key}Fr`] ?? nested.fr, fallbackFr || fallbackEn) };
  }
  private text(value: unknown, fallback = '') { return value === undefined || value === null ? fallback : String(value).trim(); }
  private integer(value: unknown, label: string) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 0) throw new BadRequestException(`${label} must be a non-negative whole number.`);
    return number;
  }
  private money(value: unknown, required: boolean) {
    if (value === undefined || value === null || value === '') {
      if (required) throw new BadRequestException('A fixed price is required for fixed-price products.');
      return null;
    }
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) throw new BadRequestException('Price must be a valid non-negative amount.');
    return new Prisma.Decimal(String(value));
  }
  private boolean(value: unknown, fallback: boolean) {
    if (value === undefined || value === null) return fallback;
    if (typeof value !== 'boolean') throw new BadRequestException('Boolean fields must be true or false.');
    return value;
  }
  private enumValue(value: unknown, allowed: string[], fallback: string): any {
    const normalized = String(value ?? fallback).toUpperCase();
    if (!allowed.includes(normalized)) throw new BadRequestException(`Unsupported value “${String(value)}”.`);
    return normalized;
  }
  private entity(resource: string) { return ({ products: 'Product', categories: 'Category', 'quotation-requests': 'QuotationRequest', 'technician-bookings': 'TechnicianBooking', 'contact-messages': 'ContactMessage', reviews: 'Review' } as Record<string, string>)[resource] || resource; }
  private productView(row: any) {
    const images = row.images.map((image: any) => ({ id: image.id, url: image.url, src: image.url, alt: image.alt, sortOrder: image.sortOrder, isCover: image.isCover }));
    return { ...row, status: row.isPublished ? 'PUBLISHED' : 'DRAFT', name: { en: row.nameEn, fr: row.nameFr }, description: { en: row.descriptionEn, fr: row.descriptionFr }, price: row.price === null ? null : Number(row.price), priceMode: row.priceMode, condition: row.condition, category: { ...row.category, name: row.category.nameEn }, images, coverImageUrl: images.find((image: any) => image.isCover)?.url || images[0]?.url || '' };
  }
  private rethrow(error: unknown): never {
    if (error instanceof BadRequestException || error instanceof NotFoundException || error instanceof ConflictException) throw error;
    if (isUniqueError(error)) throw new ConflictException('A record with this slug or SKU already exists.');
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new ConflictException('This record is still used by another record and cannot be removed.');
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') throw new NotFoundException('The requested record was not found.');
    throw error;
  }
}
