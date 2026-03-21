import { IsEnum } from 'class-validator';
import { ContractStatus } from '../../../database/entities';

export class UpdateStatusDto {
  @IsEnum(ContractStatus)
  status: ContractStatus;
}
