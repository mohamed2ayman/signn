import { IsUUID } from 'class-validator';

export class AssignObligationDto {
  @IsUUID()
  user_id: string;
}
