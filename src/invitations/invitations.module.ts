import { Module } from '@nestjs/common';
import { InvitationsService } from './invitations.service';
import { InvitationsController } from './invitations.controller';
import { PrismaModule } from 'src/prisma.module';

@Module({
  controllers: [InvitationsController],
  providers: [InvitationsService],
  imports: [PrismaModule],
})
export class InvitationsModule {}
