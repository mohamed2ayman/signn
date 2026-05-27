import { IsEmail, IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export const WAITLIST_PRODUCTS = [
  'VENDRIX',
  'SPANTEC',
  'CLAIMX',
  'GUARDIA',
  'DOXEN',
] as const;

export class CreateWaitlistEntryDto {
  // lesson #40: every DTO field needs a class-validator decorator or it gets stripped
  // lesson #42: @MaxLength must accompany @IsEmail
  @IsNotEmpty()
  @IsEmail()
  @MaxLength(255)
  email: string;

  // lesson #57: typed DTO, never Partial<Entity>
  // lesson #58: class, not interface
  @IsNotEmpty()
  @IsString()
  @IsIn(WAITLIST_PRODUCTS)
  product_name: string;
}
