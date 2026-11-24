import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { CloseGuard } from '../monthly-close/close-guard';
import { AccountTransfersController } from './account-transfers.controller';
import { AccountTransfersService } from './account-transfers.service';

@Module({
  imports: [PrismaModule],
  controllers: [AccountTransfersController],
  providers: [AccountTransfersService, CloseGuard],
  exports: [AccountTransfersService],
})
export class AccountTransfersModule {}
