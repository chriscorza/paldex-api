import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { RecurringExpensesController } from './recurring-expenses.controller';
import { RecurringExpensesService } from './recurring-expenses.service';
import { CloseGuard } from '../monthly-close/close-guard';

@Module({
  imports: [PrismaModule],
  controllers: [RecurringExpensesController],
  providers: [RecurringExpensesService, CloseGuard],
  exports: [RecurringExpensesService],
})
export class RecurringExpensesModule {}
