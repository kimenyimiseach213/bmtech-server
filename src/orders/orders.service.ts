import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { CreateOrderDto } from '../common/dto';
import { PrismaService } from '../prisma/prisma.service';

const reference = () => `BM-O-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(4).toString('hex').toUpperCase()}`;

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateOrderDto) {
    if (!dto.items?.length) throw new BadRequestException('Add at least one item to the order.');
    const clientReference = dto.clientReference?.trim() || null;
    if (clientReference) {
      const existing = await this.prisma.order.findUnique({ where: { clientReference }, include: { items: true } });
      if (existing) return this.response(existing);
    }
    const fulfillment = dto.fulfillment.method.toUpperCase() === 'COLLECTION' ? 'COLLECTION' : 'DELIVERY';
    const created = await this.prisma.$transaction(async (tx) => {
      let total = new Prisma.Decimal(0);
      const snapshots: Array<{ id: string; slug: string; name: string; sku: string; quantity: number; unitPrice: Prisma.Decimal; lineTotal: Prisma.Decimal }> = [];
      for (const item of dto.items) {
        const product = await tx.product.findFirst({
          where: { slug: item.productSlug, isPublished: true, category: { isActive: true } },
          include: { category: true },
        });
        if (!product) throw new NotFoundException(`Product “${item.productSlug}” is unavailable.`);
        if (product.priceMode !== 'FIXED' || product.price === null) throw new BadRequestException(`${product.nameEn} requires a quotation and cannot be checked out.`);
        if (product.stockQuantity < item.quantity) throw new BadRequestException(`There is not enough stock for ${product.nameEn}.`);
        const unitPrice = product.price;
        const lineTotal = unitPrice.mul(item.quantity);
        total = total.plus(lineTotal);
        const changed = await tx.product.updateMany({ where: { id: product.id, stockQuantity: { gte: item.quantity } }, data: { stockQuantity: { decrement: item.quantity } } });
        if (changed.count !== 1) throw new BadRequestException(`Stock changed while ordering ${product.nameEn}. Please review the cart.`);
        snapshots.push({ id: product.id, slug: product.slug, name: product.nameEn, sku: product.sku || '', quantity: item.quantity, unitPrice, lineTotal });
      }
      const order = await tx.order.create({
        data: {
          reference: reference(), clientReference, customerName: dto.customer.name.trim(), customerPhone: dto.customer.phone.trim(),
          customerEmail: dto.customer.email?.trim() || null, fulfillment, deliveryAddress: fulfillment === 'DELIVERY' ? dto.fulfillment.address?.trim() || null : null,
          notes: dto.notes?.trim() || null, locale: dto.locale === 'fr' ? 'fr' : 'en', total,
          items: { create: snapshots.map((item) => ({ productId: item.id, productSlug: item.slug, productName: item.name, sku: item.sku, quantity: item.quantity, unitPrice: item.unitPrice, lineTotal: item.lineTotal })) },
          payment: { create: { amount: total } },
        },
        include: { items: true },
      });
      return order;
    });
    return this.response(created);
  }

  private async response(order: any) {
    const settings = await this.prisma.companySettings.findUnique({ where: { id: 'default' } });
    const phone = (settings?.whatsapp || '250788494513').replace(/\D/g, '');
    const message = `Hello BMTECH, I have placed order ${order.reference}. Please confirm the order and payment next steps.`;
    const whatsappConfirmationUrl = `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
    return {
      order: {
        id: order.id, reference: order.reference, clientReference: order.clientReference, total: Number(order.total), status: order.status,
        paymentStatus: order.paymentStatus, fulfillment: order.fulfillment.toLowerCase(), items: order.items.map((item: any) => ({
          productSlug: item.productSlug, productName: item.productName, sku: item.sku, quantity: item.quantity,
          unitPrice: Number(item.unitPrice), lineTotal: Number(item.lineTotal),
        })),
      },
      whatsappConfirmationUrl,
    };
  }
}
