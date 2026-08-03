import { Module } from '@nestjs/common'; import { PrismaModule } from '../prisma.module'; import { ReceivablesController } from './receivables.controller'; import { ReceivablesService } from './receivables.service';
@Module({ imports: [PrismaModule], controllers: [ReceivablesController], providers: [ReceivablesService], exports: [ReceivablesService] })
export class ReceivablesModule {}
