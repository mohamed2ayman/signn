import { IsString, IsOptional } from 'class-validator';

export class UploadPolicyDto {
  @IsString()
  title: string;

  @IsOptional()
  @IsString()
  description?: string;
}
