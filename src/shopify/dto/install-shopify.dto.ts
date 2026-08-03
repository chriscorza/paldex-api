import { IsString, IsInt } from 'class-validator';

export class InstallShopifyDto {
  @IsString()
  shop_domain: string;

  @IsInt()
  account_id: number;
}
