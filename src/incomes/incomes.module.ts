import { Module } from '@nestjs/common';
import { IncomesService } from './incomes.service';
import { IncomesController } from './incomes.controller';
import { PrismaModule } from 'src/prisma.module';

@Module({
  controllers: [IncomesController],
  providers: [IncomesService],
  imports:[PrismaModule],
  exports:[IncomesService]
})
export class IncomesModule {}
