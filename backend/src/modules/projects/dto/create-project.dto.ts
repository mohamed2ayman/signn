import { IsString, IsOptional, IsDateString, MaxLength } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @MaxLength(500)
  name: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  objective?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  country?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  /**
   * Party Foundation Slice 1a — the project-level DEFAULT party role a
   * contract inherits for contracts.host_party_role_code. A CODE from the
   * party_roles registry; DELIBERATELY not an @IsEnum/@IsIn — the registry
   * (DB rows) is the single source of valid codes. ProjectsService normalizes
   * (''/whitespace → NULL) then validates the code exists AND is active.
   * NOTE: holds a CONTRACT-scoped role code — see the entity comment.
   */
  @IsOptional()
  @IsString()
  @MaxLength(50)
  default_party_role_code?: string;
}
