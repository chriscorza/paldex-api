import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { MonthlyCloseController } from './monthly-close.controller';
import { MonthlyCloseService } from './monthly-close.service';
import { CloseGuard } from './close-guard';
import { ReportsModule } from '../reports/reports.module';
@Module({
  imports: [PrismaModule, ReportsModule],
  controllers: [MonthlyCloseController],
  providers: [MonthlyCloseService, CloseGuard],
  exports: [MonthlyCloseService, CloseGuard],
})
export class MonthlyCloseModule {}
