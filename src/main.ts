import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import express from 'express';
import { resolve } from 'node:path';
import { AppModule } from './app.module';

async function bootstrap() {
  if (process.env.VERCEL && !process.env.BLOB_READ_WRITE_TOKEN) {
    throw new Error('BLOB_READ_WRITE_TOKEN is required on Vercel so product images use persistent storage.');
  }
  const app = await NestFactory.create(AppModule);
  app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
  const frontendOrigin = process.env.FRONTEND_ORIGIN;
  app.enableCors({
    origin: frontendOrigin ? frontendOrigin.split(',').map((origin) => origin.trim()) : false,
    credentials: true,
  });
  app.use('/uploads', express.static(resolve(process.cwd(), process.env.UPLOAD_DIRECTORY || './uploads')));
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, validationError: { target: false, value: false } }));

  const swagger = new DocumentBuilder()
    .setTitle('BMTECH API')
    .setDescription('BMTECH storefront and single-administrator API')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  const port = Number(process.env.PORT || 3001);
  await app.listen(port, '0.0.0.0');
  console.log(`BMTECH API listening on http://localhost:${port}/api/v1 (Swagger: /docs)`);
}

void bootstrap();
