import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  constructor() {
    super({ adapter: new PrismaMariaDb(process.env.DATABASE_URL) });
  }

  async onModuleInit() {
    await this.$connect();
  }
}
