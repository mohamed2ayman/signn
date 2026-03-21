import { IsString, MaxLength } from 'class-validator';

export class UpdateRiskStatusDto {
  @IsString()
  @MaxLength(50)
  status: string;
}
