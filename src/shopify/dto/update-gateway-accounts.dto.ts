import { IsArray, ValidateNested, IsString, IsInt } from 'class-validator';
import { Type } from 'class-transformer';

export class GatewayAccountMapping {
  @IsString()
  gateway: string;

  @IsInt()
  account_id: number;
}

export class UpdateGatewayAccountsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => GatewayAccountMapping)
  mappings: GatewayAccountMapping[];
}
