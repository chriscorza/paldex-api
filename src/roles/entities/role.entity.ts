import { Role, Permission } from '@prisma/client';

export interface RoleWithPermissions extends Role {
  permissions: { permission: Permission }[];
}

export interface PaginatedRoleResponse {
  data: Role[];
  total: number;
  page: number;
  limit: number;
}
