import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdatePartiesDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  party_first_name?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  party_second_name?: string | null;
}
