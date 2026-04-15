import { IsEmail, IsString, Length } from 'class-validator';

export class VerifyRecoveryDto {
  @IsEmail()
  email: string;

  @IsString()
  @Length(9, 9) // Format: XXXX-XXXX
  recovery_code: string;
}
