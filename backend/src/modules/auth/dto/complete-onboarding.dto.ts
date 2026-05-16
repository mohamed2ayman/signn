import { IsIn } from 'class-validator';

export class CompleteOnboardingDto {
  @IsIn(['none', 'quick', 'comprehensive'])
  level: string;
}
