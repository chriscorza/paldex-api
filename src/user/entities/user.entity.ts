import {
  IsDate,
  IsEmail,
  IsLocale,
  IsString,
  IsStrongPassword,
  IsUrl,
  IsUUID,
} from 'class-validator';
export class User {
  @IsUUID()
  id: string;

  @IsEmail()
  email: string;

  @IsStrongPassword()
  password: string;

  @IsString()
  name: string;

  @IsUrl()
  photo_url: string;

  @IsString()
  google_token_id: string;

  @IsLocale()
  locale: string;

  @IsDate()
  created_at: Date;
}
