import { IsArray, IsInt } from 'class-validator';

export class SetRolePermissionsDto {
  @IsArray()
  @IsInt({ each: true })
  permission_ids: number[];
}
