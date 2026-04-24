import { IsObject } from 'class-validator';

export class UpdateFeatureFlagsDto {
  @IsObject()
  featureFlags: Record<string, boolean>;
}
