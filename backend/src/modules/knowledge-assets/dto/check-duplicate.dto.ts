import { IsString, Length } from 'class-validator';

export class CheckDuplicateDto {
  @IsString()
  @Length(64, 64)
  hash: string;
}
