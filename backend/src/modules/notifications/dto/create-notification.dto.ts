import { IsString, IsUUID, IsEnum, IsOptional, MaxLength } from 'class-validator';
import { NotificationType } from '../../../database/entities';

export class CreateNotificationDto {
  @IsUUID()
  user_id: string;

  @IsString()
  @MaxLength(500)
  title: string;

  @IsString()
  message: string;

  @IsOptional()
  @IsEnum(NotificationType)
  type?: NotificationType;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  related_entity_type?: string;

  @IsOptional()
  @IsUUID()
  related_entity_id?: string;
}
