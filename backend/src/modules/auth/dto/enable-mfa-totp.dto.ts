import { IsString, Length } from 'class-validator';

export class EnableMfaTotpDto {
  @IsString()
  @Length(6, 6)
  totp_code: string;
}
