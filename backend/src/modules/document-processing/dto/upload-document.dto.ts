import { IsOptional, IsString, IsInt, Min, Max, MaxLength } from 'class-validator';

export class UploadDocumentDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  document_label?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  document_priority?: number;
}
