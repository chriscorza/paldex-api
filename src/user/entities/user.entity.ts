import { Prisma } from '@prisma/client';

export const USER_SELECT = {
  id: true,
  email: true,
  name: true,
  photo_url: true,
  locale: true,
  created_at: true,
} satisfies Prisma.UserSelect;

export type SafeUser = {
  id: number;
  email: string;
  name: string | null;
  photo_url: string | null;
  locale: string;
  created_at: Date;
};
