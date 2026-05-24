import { IsString, IsUrl, MaxLength } from 'class-validator';

export class UpdateEvidenceDto {
  @IsString()
  @IsUrl()
  @MaxLength(1000)
  evidence_url: string;
}
