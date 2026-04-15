import { IsString, MinLength } from 'class-validator';

export class DisableMfaDto {
  @IsString()
  @MinLength(1)
  password: string;
}
