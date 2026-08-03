import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma.module';
import { PayablesController } from './payables.controller';
import { PayablesService } from './payables.service';
@Module({ imports: [PrismaModule], controllers: [PayablesController], providers: [PayablesService], exports: [PayablesService] })
export class PayablesModule {}
