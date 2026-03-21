import { IsEmail, IsString, Length } from 'class-validator';

export class VerifyMfaDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(6, 6)
  otp_code: string;
}
