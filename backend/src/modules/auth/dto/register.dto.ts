import {
  IsEmail,
  IsString,
  MinLength,
  Matches,
  IsOptional,
  IsUUID,
  IsBoolean,
  Equals,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(12)
  @Matches(
    /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/,
    {
      message:
        'Password must be at least 12 characters and contain at least 1 uppercase letter, 1 number, and 1 special character',
    },
  )
  password: string;

  @IsString()
  @MinLength(2)
  first_name: string;

  @IsString()
  @MinLength(2)
  last_name: string;

  @IsString()
  organization_name: string;

  @IsOptional()
  @IsString()
  industry?: string;

  @IsOptional()
  @IsString()
  country?: string;

  @IsUUID()
  plan_id: string;

  @IsBoolean()
  @Equals(true, {
    message: 'You must accept the Terms and Conditions to register',
  })
  agreed_to_terms: boolean;

  @IsOptional()
  @IsBoolean()
  marketing_email_opt_in?: boolean;
}
