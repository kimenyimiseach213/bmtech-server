import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { CreateBookingDto, CreateMessageDto, CreateQuoteDto, CreateReviewDto } from '../common/dto';
import { RequestsService } from './requests.service';

@ApiTags('customer-requests')
@Controller()
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}
  @Post('quotation-requests') quote(@Body() dto: CreateQuoteDto) { return this.requests.quote(dto); }
  @Post('technician-bookings') booking(@Body() dto: CreateBookingDto) { return this.requests.booking(dto); }
  @Post('contact-messages') message(@Body() dto: CreateMessageDto) { return this.requests.message(dto); }
  @Post('reviews') review(@Body() dto: CreateReviewDto) { return this.requests.review(dto); }
}
