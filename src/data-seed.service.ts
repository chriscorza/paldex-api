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
    // Las cuentas de servicio del asistente (`@agente.paldex.local`) no llevan
    // libros propios: escriben en los de su dueño, así que no se les siembra nada.
    const users = await this.prisma.user.findMany({
      where: { NOT: { email: { endsWith: '@agente.paldex.local' } } },
      take: 100,
    });

    for (const user of users) {
      await this.expenseCategoriesService.seedSystemCategories(user.id);
    }
  }
}
