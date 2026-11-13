import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';

const MAX_ORDER_SIZE = 2_147_483_647n;
const MONEY_PATTERN = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;

export interface OrderQuantityInput {
  size?: number;
  amountARS?: string;
}

export function moneyToCents(value: unknown, field: string): bigint {
  if (typeof value !== 'string' || !MONEY_PATTERN.test(value)) {
    throw new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: `${field} must be a decimal string with at most two fractional digits` } });
  }
  const [whole, fraction = ''] = value.split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents <= 0n) {
    throw new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: `${field} must be positive` } });
  }
  return cents;
}

export function centsToMoney(cents: bigint): string {
  const sign = cents < 0n ? '-' : '';
  const absolute = cents < 0n ? -cents : cents;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function calculateOrderSize(input: OrderQuantityInput, unitPriceCents: bigint): number {
  if (unitPriceCents <= 0n) {
    throw new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'Unit price must be positive' } });
  }
  const hasSize = input.size !== undefined;
  const hasAmount = input.amountARS !== undefined;
  if (hasSize === hasAmount) {
    throw new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'Provide exactly one of size or amountARS' } });
  }

  let size: bigint;
  if (hasSize) {
    if (!Number.isInteger(input.size) || input.size! <= 0 || !Number.isSafeInteger(input.size)) {
      throw new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'size must be a positive integer' } });
    }
    size = BigInt(input.size!);
  } else {
    const amountCents = moneyToCents(input.amountARS!, 'amountARS');
    size = amountCents / unitPriceCents;
    if (size === 0n) {
      throw new UnprocessableEntityException({ error: { code: 'AMOUNT_BELOW_ONE_SHARE', message: 'amountARS is below one share at the applicable price' } });
    }
  }

  if (size > MAX_ORDER_SIZE) {
    throw new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'size exceeds the supported whole-share range' } });
  }
  return Number(size);
}
