import { IsOptional, IsUUID } from 'class-validator';

export class CreateSessionDto {
  @IsOptional()
  @IsUUID()
  contract_id?: string;
}
