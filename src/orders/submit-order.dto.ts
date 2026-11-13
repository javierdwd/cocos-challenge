import { IsIn, IsInt, IsString, Matches, Max, Min, ValidateIf } from 'class-validator';

const MONEY_PATTERN = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;

export class SubmitOrderDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  userId!: number;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  instrumentId!: number;

  @IsIn(['BUY', 'SELL'])
  side!: 'BUY' | 'SELL';

  @IsIn(['MARKET', 'LIMIT'])
  type!: 'MARKET' | 'LIMIT';

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  size?: number;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(MONEY_PATTERN)
  amountARS?: string;

  @ValidateIf((_, value: unknown) => value !== undefined)
  @IsString()
  @Matches(MONEY_PATTERN)
  limitPriceARS?: string;
}
