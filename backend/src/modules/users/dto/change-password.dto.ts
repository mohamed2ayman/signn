import { IsString, MinLength, Matches } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  old_password: string;

  @IsString()
  @MinLength(12)
  @Matches(
    /^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]).{12,}$/,
    {
      message:
        'Password must be at least 12 characters and contain at least 1 uppercase letter, 1 number, and 1 special character',
    },
  )
  new_password: string;
}
