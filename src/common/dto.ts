import { Transform, Type } from 'class-transformer';
import { Allow, IsArray, IsDefined, IsEmail, IsIn, IsInt, IsOptional, IsString, Max, Min, MinLength, ValidateNested } from 'class-validator';

export class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(1) password!: string;
}

export class BootstrapDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(2) name!: string;
  @IsString() @MinLength(12) password!: string;
}

export class CustomerDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() @MinLength(7) phone!: string;
  @Transform(({ value }) => value === '' ? undefined : value) @IsOptional() @IsEmail() email?: string;
}

export class FulfillmentDto {
  @IsString() @IsIn(['delivery', 'collection', 'DELIVERY', 'COLLECTION']) method!: string;
  @IsOptional() @IsString() address?: string;
}

export class OrderLineDto {
  @IsString() @MinLength(1) productSlug!: string;
  @IsInt() @Min(1) quantity!: number;
}

export class CreateOrderDto {
  @IsOptional() @IsString() clientReference?: string;
  @IsDefined() @ValidateNested() @Type(() => CustomerDto)
  customer!: CustomerDto;
  @IsDefined() @ValidateNested() @Type(() => FulfillmentDto)
  fulfillment!: FulfillmentDto;
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderLineDto)
  items!: OrderLineDto[];
  @IsOptional() @IsString() notes?: string;
  @IsOptional() @IsIn(['en', 'fr']) locale?: string;
}

export class CreateQuoteDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() @MinLength(7) phone!: string;
  @Transform(({ value }) => value === '' ? undefined : value) @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() selection?: string;
  @IsOptional() @IsString() productOrService?: string;
  @IsString() @MinLength(2) location!: string;
  @IsOptional() @IsString() contact?: string;
  @IsOptional() @IsString() contactMethod?: string;
  @IsOptional() @IsString() details?: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() clientReference?: string;
}

export class CreateBookingDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() @MinLength(7) phone!: string;
  @Transform(({ value }) => value === '' ? undefined : value) @IsOptional() @IsEmail() email?: string;
  @IsOptional() @IsString() service?: string;
  @IsOptional() @IsString() serviceType?: string;
  @IsOptional() @IsString() date?: string;
  @IsOptional() @IsString() preferredDate?: string;
  @IsOptional() @IsString() time?: string;
  @IsOptional() @IsString() preferredTime?: string;
  @IsString() @MinLength(2) location!: string;
  @IsOptional() @IsString() details?: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() clientReference?: string;
}

export class CreateMessageDto {
  @IsString() @MinLength(2) name!: string;
  @IsString() @MinLength(7) phone!: string;
  @Transform(({ value }) => value === '' ? undefined : value) @IsOptional() @IsEmail() email?: string;
  @IsString() @MinLength(2) message!: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() clientReference?: string;
}

export class CreateReviewDto {
  @IsOptional() @IsString() name?: string;
  @IsOptional() @IsString() displayName?: string;
  @IsInt() @Min(1) @Max(5) rating!: number;
  @IsOptional() @IsString() experience?: string;
  @IsOptional() @IsString() comment?: string;
  @IsOptional() @IsString() locale?: string;
  @IsOptional() @IsString() clientReference?: string;
}

export class AdminRecordDto {
  @Allow() @IsOptional() id?: unknown;
  @Allow() @IsOptional() slug?: unknown;
  @Allow() @IsOptional() sku?: unknown;
  @Allow() @IsOptional() categoryId?: unknown;
  @Allow() @IsOptional() brand?: unknown;
  @Allow() @IsOptional() model?: unknown;
  @Allow() @IsOptional() nameEn?: unknown;
  @Allow() @IsOptional() nameFr?: unknown;
  @Allow() @IsOptional() name?: unknown;
  @Allow() @IsOptional() descriptionEn?: unknown;
  @Allow() @IsOptional() descriptionFr?: unknown;
  @Allow() @IsOptional() description?: unknown;
  @Allow() @IsOptional() condition?: unknown;
  @Allow() @IsOptional() priceMode?: unknown;
  @Allow() @IsOptional() price?: unknown;
  @Allow() @IsOptional() stockQuantity?: unknown;
  @Allow() @IsOptional() installationAvailable?: unknown;
  @Allow() @IsOptional() isPublished?: unknown;
  @Allow() @IsOptional() isActive?: unknown;
  @Allow() @IsOptional() sortOrder?: unknown;
  @Allow() @IsOptional() status?: unknown;
  @Allow() @IsOptional() quotedAmount?: unknown;
  @Allow() @IsOptional() scheduledAt?: unknown;
  @Allow() @IsOptional() adminNotes?: unknown;
  @Allow() @IsOptional() companyName?: unknown;
  @Allow() @IsOptional() phone?: unknown;
  @Allow() @IsOptional() whatsapp?: unknown;
  @Allow() @IsOptional() email?: unknown;
  @Allow() @IsOptional() businessHours?: unknown;
  @Allow() @IsOptional() aboutEn?: unknown;
  @Allow() @IsOptional() aboutFr?: unknown;
  @Allow() @IsOptional() imageIds?: unknown;
  @Allow() @IsOptional() coverImageId?: unknown;
}

export class ReorderDto {
  @IsInt() sortOrder!: number;
}

export class ImageReorderDto {
  @IsArray() @IsString({ each: true }) imageIds!: string[];
  @IsOptional() @IsString() coverImageId?: string;
}
