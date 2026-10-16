import { BadRequestException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { CreateBookingDto, CreateMessageDto, CreateQuoteDto, CreateReviewDto } from '../common/dto';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';

const code = (kind: string) => `BM-${kind}-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomBytes(3).toString('hex').toUpperCase()}`;
const locale = (value?: string) => value === 'fr' ? 'fr' : 'en';

@Injectable()
export class RequestsService {
  constructor(private readonly prisma: PrismaService, private readonly mail: MailService) {}

  async quote(dto: CreateQuoteDto) {
    const item = await this.prisma.quotationRequest.create({ data: {
      reference: code('Q'), name: dto.name.trim(), phone: dto.phone.trim(), email: dto.email?.trim() || null,
      productOrService: (dto.productOrService || dto.selection || '').trim(), location: dto.location.trim(),
      contactMethod: (dto.contactMethod || dto.contact || 'WhatsApp').trim(), details: (dto.details || '').trim(), locale: locale(dto.locale),
    } });
    void this.mail.notifyRequest('Quotation request', item.reference, [
      { label: 'Customer name', value: item.name }, { label: 'Customer phone', value: item.phone }, { label: 'Customer email', value: item.email || '' },
      { label: 'Product or service', value: item.productOrService }, { label: 'Location', value: item.location }, { label: 'Preferred contact', value: item.contactMethod }, { label: 'Details', value: item.details },
    ]);
    return { request: { id: item.id, reference: item.reference, status: item.status, createdAt: item.createdAt } };
  }

  async booking(dto: CreateBookingDto) {
    const date = dto.preferredDate || dto.date;
    const time = dto.preferredTime || dto.time;
    const service = dto.service || dto.serviceType;
    if (!date || !time || !service) throw new BadRequestException('Service, preferred date and preferred time are required.');
    const preferredDate = new Date(`${date}T00:00:00.000Z`);
    if (!Number.isFinite(preferredDate.getTime())) throw new BadRequestException('Preferred date is invalid.');
    const item = await this.prisma.technicianBooking.create({ data: {
      reference: code('B'), name: dto.name.trim(), phone: dto.phone.trim(), email: dto.email?.trim() || null,
      service: service.trim(), preferredDate, preferredTime: time.trim(), location: dto.location.trim(),
      details: (dto.details || '').trim(), locale: locale(dto.locale),
    } });
    void this.mail.notifyRequest('Technician booking', item.reference, [
      { label: 'Customer name', value: item.name }, { label: 'Customer phone', value: item.phone }, { label: 'Customer email', value: item.email || '' },
      { label: 'Service', value: item.service }, { label: 'Preferred date', value: item.preferredDate.toISOString().slice(0, 10) }, { label: 'Preferred time', value: item.preferredTime }, { label: 'Location', value: item.location }, { label: 'Details', value: item.details },
    ]);
    return { request: { id: item.id, reference: item.reference, status: item.status, createdAt: item.createdAt } };
  }

  async message(dto: CreateMessageDto) {
    const item = await this.prisma.contactMessage.create({ data: {
      reference: code('M'), name: dto.name.trim(), phone: dto.phone.trim(), email: dto.email?.trim() || null,
      message: dto.message.trim(), locale: locale(dto.locale),
    } });
    void this.mail.notifyRequest('Contact message', item.reference, [
      { label: 'Customer name', value: item.name }, { label: 'Customer phone', value: item.phone }, { label: 'Customer email', value: item.email || '' }, { label: 'Message', value: item.message },
    ]);
    return { request: { id: item.id, reference: item.reference, status: item.status, createdAt: item.createdAt } };
  }

  async review(dto: CreateReviewDto) {
    const name = (dto.name || dto.displayName || '').trim();
    const experience = (dto.experience || dto.comment || '').trim();
    if (!name || !experience) throw new BadRequestException('Name and review text are required.');
    const item = await this.prisma.review.create({ data: { reference: code('R'), name, rating: dto.rating, experience, locale: locale(dto.locale) } });
    return { request: { id: item.id, reference: item.reference, status: item.status, createdAt: item.createdAt } };
  }
}
