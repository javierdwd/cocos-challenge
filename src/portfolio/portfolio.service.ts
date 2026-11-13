import { Inject, Injectable, InternalServerErrorException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

interface PortfolioMovement {
  source_type: string;
  source_id: number;
  instrument_id: number | null;
  share_delta: number;
  cash_delta_ars: { toString(): string };
}

interface Fraction {
  numerator: bigint;
  denominator: bigint;
}

interface Holding {
  size: bigint;
  cost: Fraction;
}

export interface PortfolioResponse {
  userId: number;
  totalValueARS: string;
  availableCashARS: string;
  positions: Array<{
    instrumentId: number;
    ticker: string;
    name: string;
    size: number;
    marketValueARS: string;
    totalReturnPct: string | null;
  }>;
}

function greatestCommonDivisor(left: bigint, right: bigint): bigint {
  while (right !== 0n) {
    [left, right] = [right, left % right];
  }
  return left;
}

function fraction(numerator: bigint, denominator: bigint): Fraction {
  const divisor = greatestCommonDivisor(numerator, denominator);
  return { numerator: numerator / divisor, denominator: denominator / divisor };
}

function cents(value: { toString(): string }): bigint {
  const match = /^(-?)(\d+)(?:\.(\d{1,2}))?$/.exec(value.toString());
  if (!match) throw new InternalServerErrorException('Invalid monetary movement');
  const amount = BigInt(match[2]) * 100n + BigInt((match[3] ?? '').padEnd(2, '0'));
  return match[1] === '-' ? -amount : amount;
}

function twoDecimals(value: bigint): string {
  const sign = value < 0n ? '-' : '';
  const absolute = value < 0n ? -value : value;
  return `${sign}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

function divideHalfUp(numerator: bigint, denominator: bigint): bigint {
  const negative = numerator < 0n;
  const absolute = negative ? -numerator : numerator;
  const rounded = (absolute * 2n + denominator) / (denominator * 2n);
  return negative ? -rounded : rounded;
}

@Injectable()
export class PortfolioService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async getPortfolio(userId: number): Promise<PortfolioResponse> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) {
      throw new NotFoundException({ error: { code: 'NOT_FOUND', message: 'User not found' } });
    }

    const movements = await this.prisma.$queryRaw<PortfolioMovement[]>`
      SELECT source_type, source_id, instrument_id, share_delta, cash_delta_ars
      FROM portfolio_movements
      WHERE user_id = ${userId}
      ORDER BY datetime, source_type, source_id
    `;

    let cash = 0n;
    const holdings = new Map<number, Holding>();
    for (const movement of movements) {
      const cashDelta = cents(movement.cash_delta_ars);
      cash += cashDelta;
      if (movement.instrument_id === null) continue;

      const instrumentId = movement.instrument_id;
      const holding = holdings.get(instrumentId) ?? { size: 0n, cost: fraction(0n, 1n) };
      const change = BigInt(movement.share_delta);
      if (change > 0n) {
        holding.cost = fraction(
          holding.cost.numerator - cashDelta * holding.cost.denominator,
          holding.cost.denominator,
        );
        holding.size += change;
      } else if (change < 0n) {
        const remaining = holding.size + change;
        if (remaining < 0n || holding.size === 0n) {
          throw new InternalServerErrorException('Invalid portfolio movement sequence');
        }
        holding.cost = remaining === 0n
          ? fraction(0n, 1n)
          : fraction(holding.cost.numerator * remaining, holding.cost.denominator * holding.size);
        holding.size = remaining;
      }
      holdings.set(instrumentId, holding);
    }

    const heldIds = [...holdings.entries()]
      .filter(([, holding]) => holding.size > 0n)
      .map(([id]) => id);
    const instruments = heldIds.length === 0 ? [] : await this.prisma.instrument.findMany({
      where: { id: { in: heldIds } },
      select: {
        id: true,
        ticker: true,
        name: true,
        marketdata: {
          orderBy: [{ datetime: 'desc' }, { id: 'desc' }],
          take: 1,
          select: { close: true },
        },
      },
      orderBy: [{ ticker: 'asc' }, { id: 'asc' }],
    });

    if (instruments.length !== heldIds.length || instruments.some((item) => item.marketdata.length === 0)) {
      throw new ServiceUnavailableException({
        error: { code: 'MARKET_PRICE_UNAVAILABLE', message: 'Portfolio market price unavailable' },
      });
    }

    let totalValue = cash;
    const positions = instruments.map((instrument) => {
      const holding = holdings.get(instrument.id)!;
      const size = Number(holding.size);
      if (!Number.isSafeInteger(size)) {
        throw new InternalServerErrorException('Portfolio share count exceeds supported range');
      }
      const marketValue = holding.size * cents(instrument.marketdata[0].close);
      totalValue += marketValue;
      const { numerator, denominator } = holding.cost;
      const returnCents = numerator === 0n
        ? null
        : divideHalfUp((marketValue * denominator - numerator) * 10000n, numerator);

      return {
        instrumentId: instrument.id,
        ticker: instrument.ticker,
        name: instrument.name,
        size,
        marketValueARS: twoDecimals(marketValue),
        totalReturnPct: returnCents === null ? null : twoDecimals(returnCents),
      };
    });

    return {
      userId,
      totalValueARS: twoDecimals(totalValue),
      availableCashARS: twoDecimals(cash),
      positions,
    };
  }
}
