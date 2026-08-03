import { IsInt } from 'class-validator';

export class AssignRoleDto {
  @IsInt()
  role_id: number;
}
