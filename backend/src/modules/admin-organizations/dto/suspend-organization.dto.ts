import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SuspendOrganizationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason: string;
}
