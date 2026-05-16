import { IsString, MaxLength } from 'class-validator';

export class UpdateCommentContentDto {
  @IsString()
  @MaxLength(5000)
  content: string;
}
