import { Module } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { ExpensesController } from './expenses.controller';
import { PrismaModule } from 'src/prisma.module';

@Module({
  controllers: [ExpensesController],
  providers: [ExpensesService],
  imports: [PrismaModule],
  exports: [ExpensesService],
})
export class ExpensesModule {}
