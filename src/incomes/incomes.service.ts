import { Injectable } from '@nestjs/common';
import { Income, Prisma } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
@Injectable()
export class IncomesService {
  constructor(private prisma: PrismaService) {}

   async findAll(
      incomesWhereInput: Prisma.IncomeWhereInput,
    ): Promise<Income[] | []> {
      return this.prisma.income.findMany({
        where: incomesWhereInput,
      });
    }
}
