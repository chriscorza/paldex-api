import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { CogsController } from './cogs.controller';
import { CogsService } from './cogs.service';

@Module({
  imports: [PrismaModule],
  controllers: [CogsController],
  providers: [CogsService],
  exports: [CogsService],
})
export class CogsModule {}
