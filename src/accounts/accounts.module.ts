import { Module } from '@nestjs/common';
import { AccountsService } from './accounts.service';
import { AccountsController } from './accounts.controller';
import { PrismaModule } from 'src/prisma.module';

@Module({
  controllers: [AccountsController],
  providers: [AccountsService],
  imports: [PrismaModule],
  exports: [AccountsService],
})
export class AccountsModule {}
