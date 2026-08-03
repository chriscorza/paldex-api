import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { ProductCostsController } from './product-costs.controller';
import { ProductCostsService } from './product-costs.service';

@Module({
  imports: [PrismaModule],
  controllers: [ProductCostsController],
  providers: [ProductCostsService],
  exports: [ProductCostsService],
})
export class ProductCostsModule {}
