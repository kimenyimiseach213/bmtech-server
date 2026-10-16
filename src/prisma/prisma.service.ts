import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { neonConfig } from '@neondatabase/serverless';
import { PrismaNeon } from '@prisma/adapter-neon';
import ws from 'ws';

neonConfig.webSocketConstructor = ws;

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required.');
    const adapter = connectionString.includes('.neon.tech') ? new PrismaNeon({ connectionString }) : undefined;
    // Neon may need several seconds to wake its compute or acquire a pooled
    // connection. Prisma's 5s interactive-transaction default is too short
    // for checkout's stock checks and order writes in that case.
    const transactionOptions = { maxWait: 10_000, timeout: 30_000 };
    super(adapter ? { adapter, transactionOptions } : { transactionOptions });
  }
  async onModuleInit() { await this.$connect(); }
  async onModuleDestroy() { await this.$disconnect(); }
}
