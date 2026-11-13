import { describe, expect, it, vi } from 'vitest';
import type { Prisma } from '../src/generated/prisma/client.js';
import { OrderAccountingService, type OrderAccountingInput } from '../src/orders/order-accounting.service.js';
import { calculateOrderSize } from '../src/orders/order-pricing.js';

function transaction(cashARS: string, heldShares: bigint = 0n, close: string | null = '0.10') {
  const read = vi.fn()
    .mockResolvedValueOnce([{ id: 7 }])
    .mockResolvedValueOnce([{ cash_ars: cashARS, held_shares: heldShares }]);
  const findInstrument = vi.fn().mockResolvedValue({ id: 11 });
  const findPrice = vi.fn().mockResolvedValue(close === null ? null : { close });
  return {
    tx: {
      $queryRaw: read,
      instrument: { findUnique: findInstrument },
      marketData: { findFirst: findPrice },
    } as unknown as Prisma.TransactionClient,
    read,
    findInstrument,
    findPrice,
  };
}

const marketBuy: OrderAccountingInput = {
  userId: 7,
  instrumentId: 11,
  side: 'BUY',
  type: 'MARKET',
  amountARS: '0.30',
};

describe('order pricing', () => {
  it('uses exact cents and floors to whole shares without rounding up', () => {
    expect(calculateOrderSize({ amountARS: '0.30' }, 10n)).toBe(3);
    expect(calculateOrderSize({ amountARS: '0.29' }, 10n)).toBe(2);
    expect(calculateOrderSize({ amountARS: '3.99' }, 199n)).toBe(2);
    expect(calculateOrderSize({ size: 3 }, 10n)).toBe(3);
  });

  it('rejects zero, fractional, and mutually supplied quantities', () => {
    expect(() => calculateOrderSize({ size: 0 }, 10n)).toThrow();
    expect(() => calculateOrderSize({ size: 1.5 }, 10n)).toThrow();
    expect(() => calculateOrderSize({ size: 1, amountARS: '0.10' }, 10n)).toThrow();
    expect(() => calculateOrderSize({}, 10n)).toThrow();
  });

  it('returns 422 when a positive amount cannot buy one share', () => {
    try {
      calculateOrderSize({ amountARS: '0.09' }, 10n);
      throw new Error('Expected an unprocessable amount');
    } catch (error) {
      expect(error).toMatchObject({ status: 422 });
    }
  });

  it('rejects a numeric amount instead of coercing it into a decimal string', () => {
    expect(() => calculateOrderSize({ amountARS: 0.30 as unknown as string }, 10n)).toThrowError(
      expect.objectContaining({ status: 400 }),
    );
  });
});

describe('OrderAccountingService', () => {
  const service = new OrderAccountingService();

  it('locks the user before reading FILLED movements and accepts an exact-cash MARKET buy', async () => {
    const { tx, read, findPrice } = transaction('0.30');
    const result = await service.assess(tx, marketBuy);

    expect(result).toEqual({ size: 3, priceARS: '0.10', notionalARS: '0.30', decision: 'ACCEPT', rejectionReason: null });
    expect(findPrice).toHaveBeenCalledWith({
      where: { instrumentId: 11 },
      orderBy: [{ datetime: 'desc' }, { id: 'desc' }],
      select: { close: true },
    });
    expect(read).toHaveBeenCalledTimes(2);
    expect(read.mock.calls[0][0].join('')).toContain('FOR UPDATE');
    expect(read.mock.calls[1][0].join('')).toContain('FROM portfolio_movements');
  });

  it('rejects a BUY short by one cent', async () => {
    const { tx } = transaction('0.29');
    expect(await service.assess(tx, marketBuy)).toMatchObject({ decision: 'REJECT', rejectionReason: 'INSUFFICIENT_CASH' });
  });

  it('uses the submitted LIMIT price and does not reserve cash for another NEW order', async () => {
    const input: OrderAccountingInput = { ...marketBuy, type: 'LIMIT', amountARS: '8.01', limitPriceARS: '4.00' };
    const first = transaction('8.00');
    const second = transaction('8.00');

    expect(await service.assess(first.tx, input)).toEqual({ size: 2, priceARS: '4.00', notionalARS: '8.00', decision: 'ACCEPT', rejectionReason: null });
    expect(await service.assess(second.tx, input)).toMatchObject({ decision: 'ACCEPT' });
    expect(first.findPrice).not.toHaveBeenCalled();
    expect(second.read.mock.calls[1][0].join('')).toContain('FROM portfolio_movements');
  });

  it('allows a partial sale but rejects shares beyond FILLED holdings', async () => {
    const input: OrderAccountingInput = { ...marketBuy, side: 'SELL', size: 2, amountARS: undefined };
    expect(await service.assess(transaction('0.00', 3n).tx, input)).toMatchObject({ decision: 'ACCEPT', size: 2 });
    expect(await service.assess(transaction('0.00', 1n).tx, input)).toMatchObject({ decision: 'REJECT', rejectionReason: 'INSUFFICIENT_SHARES' });
  });

  it('converts a SELL amount to whole shares at the submitted LIMIT price', async () => {
    const input: OrderAccountingInput = {
      userId: 7,
      instrumentId: 11,
      side: 'SELL',
      type: 'LIMIT',
      amountARS: '5.99',
      limitPriceARS: '2.00',
    };
    expect(await service.assess(transaction('0.00', 2n).tx, input)).toEqual({
      size: 2,
      priceARS: '2.00',
      notionalARS: '4.00',
      decision: 'ACCEPT',
      rejectionReason: null,
    });
  });

  it('does not read balances when the amount is below one share', async () => {
    const { tx, read } = transaction('100.00');
    await expect(service.assess(tx, { ...marketBuy, amountARS: '0.09' })).rejects.toMatchObject({ status: 422 });
    expect(read).toHaveBeenCalledTimes(1);
  });

  it('reports a missing MARKET close without reading balances', async () => {
    const { tx, read } = transaction('100.00', 0n, null);
    await expect(service.assess(tx, marketBuy)).rejects.toMatchObject({ status: 503 });
    expect(read).toHaveBeenCalledTimes(1);
  });
});
