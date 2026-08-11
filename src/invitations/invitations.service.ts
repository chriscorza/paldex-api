import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InvitationStatus } from '@prisma/client';
import { PrismaService } from 'src/prisma.service';
import { INVITATION_SELECT, InvitationView } from './entities/invitation.entity';

@Injectable()
export class InvitationsService {
  constructor(private prisma: PrismaService) {}

  async create(email: string, invitedBy: number): Promise<InvitationView> {
    const existing = await this.prisma.invitation.findUnique({
      where: { email },
    });

    if (!existing) {
      return this.prisma.invitation.create({
        data: { email, invited_by: invitedBy, status: InvitationStatus.PENDING },
        select: INVITATION_SELECT,
      });
    }

    if (existing.status !== InvitationStatus.REVOKED) {
      throw new ConflictException(
        `"${email}" ya tiene una invitación en estado ${existing.status}`,
      );
    }

    return this.prisma.invitation.update({
      where: { id: existing.id },
      data: {
        status: existing.user_id
          ? InvitationStatus.ACTIVE
          : InvitationStatus.PENDING,
        revoked_at: null,
      },
      select: INVITATION_SELECT,
    });
  }

  findAll(): Promise<InvitationView[]> {
    return this.prisma.invitation.findMany({
      select: INVITATION_SELECT,
      orderBy: { created_at: 'desc' },
    });
  }

  async revoke(id: number): Promise<InvitationView> {
    const existing = await this.prisma.invitation.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new NotFoundException(`Invitation with id ${id} not found`);
    }

    return this.prisma.invitation.update({
      where: { id },
      data: { status: InvitationStatus.REVOKED, revoked_at: new Date() },
      select: INVITATION_SELECT,
    });
  }
}
