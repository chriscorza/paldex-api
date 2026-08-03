import { Module } from '@nestjs/common';
import { TaxesService } from './taxes.service';
import { TaxesController } from './taxes.controller';
import { PrismaModule } from 'src/prisma.module';

@Module({
  controllers: [TaxesController],
  providers: [TaxesService],
  imports: [PrismaModule],
  exports: [TaxesService],
})
export class TaxesModule {}
