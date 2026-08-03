import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { ExpenseCategoriesService } from './expense-categories/expense-categories.service';

@Injectable()
export class DataSeedService implements OnModuleInit {
  constructor(
    private prisma: PrismaService,
    private expenseCategoriesService: ExpenseCategoriesService,
  ) {}

  async onModuleInit() {
    const users = await this.prisma.user.findMany({ take: 100 });

    for (const user of users) {
      await this.expenseCategoriesService.seedSystemCategories(user.id);
    }
  }
}
