import { IsArray, IsUUID, ArrayMinSize } from 'class-validator';

export class RequestApprovalDto {
  @IsArray()
  @ArrayMinSize(1)
  @IsUUID('4', { each: true })
  approver_ids: string[];
}
