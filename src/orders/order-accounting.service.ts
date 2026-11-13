import { BadRequestException, Injectable, InternalServerErrorException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { calculateOrderSize, centsToMoney, moneyToCents, type OrderQuantityInput } from './order-pricing.js';

export interface OrderAccountingInput extends OrderQuantityInput {
  userId: number;
  instrumentId: number;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  limitPriceARS?: string;
}

export type OrderAccountingResult = {
  size: number;
  priceARS: string;
  notionalARS: string;
} & (
  | { decision: 'ACCEPT'; rejectionReason: null }
  | { decision: 'REJECT'; rejectionReason: 'INSUFFICIENT_CASH' | 'INSUFFICIENT_SHARES' }
);

interface LockedUser { id: number }
interface Resources {
  cash_ars: { toString(): string };
  held_shares: bigint;
}

@Injectable()
export class OrderAccountingService {
  // The caller validates input and persists the order in its transaction.
  async assess(tx: Prisma.TransactionClient, input: OrderAccountingInput): Promise<OrderAccountingResult> {
    const lockedUsers = await tx.$queryRaw<LockedUser[]>`
      SELECT id FROM users WHERE id = ${input.userId} FOR UPDATE
    `;
    if (lockedUsers.length === 0) {
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    const instrument = await tx.instrument.findUnique({ where: { id: input.instrumentId }, select: { id: true } });
    if (!instrument) {
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'Instrument not found' } });
    }

    let priceCents: bigint;
    if (input.type === 'MARKET') {
      if (input.limitPriceARS !== undefined) {
        throw new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'MARKET orders cannot include limitPriceARS' } });
      }
      const latestPrice = await tx.marketData.findFirst({
        where: { instrumentId: input.instrumentId },
        orderBy: [{ datetime: 'desc' }, { id: 'desc' }],
        select: { close: true },
      });
      if (!latestPrice) {
        throw new ServiceUnavailableException({ error: { code: 'MARKET_PRICE_UNAVAILABLE', message: 'Market price unavailable' } });
      }
      priceCents = moneyToCents(latestPrice.close.toString(), 'market close');
    } else {
      if (input.limitPriceARS === undefined) {
        throw new BadRequestException({ error: { code: 'VALIDATION_ERROR', message: 'LIMIT orders require limitPriceARS' } });
      }
      priceCents = moneyToCents(input.limitPriceARS, 'limitPriceARS');
    }

    const size = calculateOrderSize(input, priceCents);
    const resources = await tx.$queryRaw<Resources[]>`
      SELECT
        COALESCE(SUM(cash_delta_ars), 0)::numeric AS cash_ars,
        COALESCE(SUM(share_delta) FILTER (WHERE instrument_id = ${input.instrumentId}), 0)::bigint AS held_shares
      FROM portfolio_movements
      WHERE user_id = ${input.userId}
    `;
    const availableCashCents = moneyToCentsOrZero(resources[0].cash_ars.toString());
    const notionalCents = BigInt(size) * priceCents;
    const base = { size, priceARS: centsToMoney(priceCents), notionalARS: centsToMoney(notionalCents) };

    if (input.side === 'BUY' && notionalCents > availableCashCents) {
      return { ...base, decision: 'REJECT', rejectionReason: 'INSUFFICIENT_CASH' };
    }
    if (input.side === 'SELL' && BigInt(size) > resources[0].held_shares) {
      return { ...base, decision: 'REJECT', rejectionReason: 'INSUFFICIENT_SHARES' };
    }
    return { ...base, decision: 'ACCEPT', rejectionReason: null };
  }
}

function moneyToCentsOrZero(value: string): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) throw new InternalServerErrorException('Invalid cash balance');
  const cents = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] === '-' ? -cents : cents;
}
