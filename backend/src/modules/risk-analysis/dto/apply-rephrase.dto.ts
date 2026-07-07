import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Risk-tab rework — STEP 3 / TASK 3. Body for
 * `POST /risk-analysis/:id/rephrase/apply`.
 *
 * `accept` = Merge & Apply (promote the AI-proposed clause onto the risk's live
 * clause via the parent-chain). `reject` = Cancel (discard the proposal; the
 * recommendation stays in place under its clause).
 *
 * `mark_handled` (TASK 3, design 3a) — when accepting, also resolve the risk
 * (existing APPROVED + handled_by/at). Optional; the controller defaults it to
 * TRUE (the checkbox is checked by default). Ignored on reject.
 */
export class ApplyRephraseDto {
  @IsIn(['accept', 'reject'])
  action: 'accept' | 'reject';

  @IsOptional()
  @IsBoolean()
  mark_handled?: boolean;
}

/**
 * TASK 2 (Option C). Body for `POST /risk-analysis/:id/rephrase/edit` — persist
 * an edit to the PENDING proposed clause's text so it survives reload and is
 * what gets merged.
 */
export class EditProposalDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  title?: string;

  @IsString()
  @MaxLength(500000)
  content: string;
}
