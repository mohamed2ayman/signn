import { IsOptional, IsString, MaxLength } from 'class-validator';

export class ParseDocxBodyDto {
  @IsOptional()
  @IsString()
  @MaxLength(500000)
  text?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  contract_type?: string;
}
