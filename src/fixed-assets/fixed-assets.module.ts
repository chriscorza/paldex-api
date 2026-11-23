import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { FixedAssetsController } from './fixed-assets.controller';
import { FixedAssetsService } from './fixed-assets.service';

@Module({
  imports: [PrismaModule],
  controllers: [FixedAssetsController],
  providers: [FixedAssetsService],
  exports: [FixedAssetsService],
})
export class FixedAssetsModule {}
