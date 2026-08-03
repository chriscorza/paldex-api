import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { TaxPaymentsController } from './tax-payments.controller';
import { TaxPaymentsService } from './tax-payments.service';

@Module({
  imports: [PrismaModule],
  controllers: [TaxPaymentsController],
  providers: [TaxPaymentsService],
  exports: [TaxPaymentsService],
})
export class TaxPaymentsModule {}
