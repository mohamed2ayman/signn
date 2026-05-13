import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateOrganizationDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  industry?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  crn?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  country?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  logo_url?: string;
}
