import { Module } from '@nestjs/common';
import { RequestsController } from './requests.controller';
import { RequestsService } from './requests.service';
import { MailService } from './mail.service';

@Module({ controllers: [RequestsController], providers: [RequestsService, MailService] })
export class RequestsModule {}
