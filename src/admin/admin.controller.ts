import { BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UploadedFiles, UseGuards, UseInterceptors } from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { diskStorage, memoryStorage } from 'multer';
import { mkdirSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import type { Request } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { AdminRecordDto, ImageReorderDto, ReorderDto } from '../common/dto';
import { AdminService } from './admin.service';

type AdminRequest = Request & { user: { sub: string; email: string } };
const uploadRoot = () => resolve(process.cwd(), process.env.UPLOAD_DIRECTORY || './uploads');
const useBlobStorage = () => Boolean(process.env.BLOB_READ_WRITE_TOKEN);

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  @Get('dashboard/summary') summary() { return this.admin.summary(); }
  @Get('settings') settings() { return this.admin.settings(); }
  @Patch('settings') updateSettings(@Body() body: AdminRecordDto, @Req() req: AdminRequest) { return this.admin.updateSettings(body, req.user.sub); }
  @Get(':resource') list(@Param('resource') resource: string, @Query('search') search?: string) { return this.admin.list(resource, search); }
  @Post(':resource') create(@Param('resource') resource: string, @Body() body: AdminRecordDto, @Req() req: AdminRequest) { return this.admin.create(resource, body, req.user.sub); }
  @Patch('categories/:id/reorder') reorderCategory(@Param('id') id: string, @Body() body: ReorderDto, @Req() req: AdminRequest) { return this.admin.reorderCategory(id, body.sortOrder, req.user.sub); }
  @Post('orders/:orderId/payment/verify') verifyOrderPayment(@Param('orderId') id: string, @Req() req: AdminRequest) { return this.admin.verifyOrderPayment(id, req.user.sub); }
  @Post('payments/:paymentId/verify') verifyPayment(@Param('paymentId') id: string, @Req() req: AdminRequest) { return this.admin.verifyPayment(id, req.user.sub); }
  @Post('products/:id/images')
  @UseInterceptors(FilesInterceptor('files', 12, {
    storage: useBlobStorage() ? memoryStorage() : diskStorage({
      destination: (_request, _file, callback) => {
        try { mkdirSync(uploadRoot(), { recursive: true }); callback(null, uploadRoot()); }
        catch (error) { callback(error as Error, uploadRoot()); }
      },
      filename: (_request, file, callback) => {
        const extension = ({ 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' } as Record<string, string>)[file.mimetype];
        callback(null, `${Date.now()}-${randomBytes(8).toString('hex')}${extension || '.img'}`);
      },
    }),
    limits: { fileSize: Math.min(Number(process.env.MAX_UPLOAD_BYTES || 8 * 1024 * 1024), process.env.VERCEL ? 4_000_000 : Number.MAX_SAFE_INTEGER) },
    fileFilter: (_request, file, callback) => {
      if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) return callback(new BadRequestException('Only JPEG, PNG, WebP and GIF images can be uploaded.'), false);
      callback(null, true);
    },
  }))
  uploadImages(@Param('id') id: string, @UploadedFiles() files: Express.Multer.File[], @Req() req: AdminRequest) { return this.admin.addImages(id, files || [], req.user.sub); }
  @Delete('products/:id/images/:imageId') deleteImage(@Param('id') id: string, @Param('imageId') imageId: string, @Req() req: AdminRequest) { return this.admin.deleteImage(id, imageId, req.user.sub); }
  @Patch('products/:id/images/reorder') reorderImages(@Param('id') id: string, @Body() body: ImageReorderDto, @Req() req: AdminRequest) { return this.admin.reorderImages(id, body, req.user.sub); }
  @Patch(':resource/:id') update(@Param('resource') resource: string, @Param('id') id: string, @Body() body: AdminRecordDto, @Req() req: AdminRequest) { return this.admin.update(resource, id, body, req.user.sub); }
  @Delete(':resource/:id') remove(@Param('resource') resource: string, @Param('id') id: string, @Req() req: AdminRequest) { return this.admin.remove(resource, id, req.user.sub); }
}
