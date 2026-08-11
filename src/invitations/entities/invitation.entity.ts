import { InvitationStatus, Prisma } from '@prisma/client';

export const INVITATION_SELECT = {
  id: true,
  email: true,
  status: true,
  user_id: true,
  invited_by: true,
  created_at: true,
  accepted_at: true,
  revoked_at: true,
} satisfies Prisma.InvitationSelect;

export type InvitationView = {
  id: number;
  email: string;
  status: InvitationStatus;
  user_id: number | null;
  invited_by: number | null;
  created_at: Date;
  accepted_at: Date | null;
  revoked_at: Date | null;
};
