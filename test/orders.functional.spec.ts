import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.js';
import { PrismaService } from '../src/database/prisma.service.js';

const marketBuy = { userId: 1, instrumentId: 1, side: 'BUY', type: 'MARKET', size: 2 };

describe('API acceptance against PostgreSQL', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  function postOrder(key: string, body: Record<string, unknown> = marketBuy) {
    return request(app.getHttpServer()).post('/orders').set('Idempotency-Key', key).send(body);
  }

  function portfolio() {
    return request(app.getHttpServer()).get('/users/1/portfolio');
  }

  beforeAll(async () => {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl || new URL(databaseUrl).pathname !== '/cocos_test') {
      throw new Error('Functional tests require a dedicated cocos_test database');
    }

    app = await NestFactory.create(AppModule, { logger: false });
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  }, 30_000);

  beforeEach(async () => {
    await prisma.$executeRawUnsafe('TRUNCATE TABLE users, instruments RESTART IDENTITY CASCADE');
    await prisma.user.create({ data: { email: 'order-test@example.com', accountNumber: 'order-test' } });
    await prisma.instrument.create({ data: { ticker: 'TEST', name: 'Test share', type: 'ACCIONES' } });
    await prisma.marketData.createMany({ data: [
      { instrumentId: 1, high: '9.00', low: '9.00', open: '9.00', close: '9.00', datetime: new Date('2026-01-01T12:00:00.000Z') },
      { instrumentId: 1, high: '10.25', low: '10.25', open: '10.25', close: '10.25', datetime: new Date('2026-01-02T12:00:00.000Z') },
    ] });
    await prisma.cashMovement.create({ data: { userId: 1, side: 'CASH_IN', amount: '100.00', status: 'FILLED' } });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('searches tickers and names case-insensitively with stable pagination', async () => {
    await prisma.instrument.createMany({ data: [
      { ticker: 'BANK', name: 'First Share', type: 'ACCIONES' },
      { ticker: 'ABCD', name: 'Bank Alpha', type: 'ACCIONES' },
      { ticker: 'BC', name: 'Bank Beta', type: 'ACCIONES' },
      { ticker: 'BANK2', name: 'Second Share', type: 'ACCIONES' },
      { ticker: 'BANKCASH', name: 'Bank Currency', type: 'MONEDA' },
      { ticker: 'OTHER', name: 'Unrelated Share', type: 'ACCIONES' },
    ] });

    const first = await request(app.getHttpServer()).get('/instruments')
      .query({ query: '  bAnK  ', pageSize: 2 });
    const second = await request(app.getHttpServer()).get('/instruments')
      .query({ query: 'bank', page: 2, pageSize: 2 });
    const beyond = await request(app.getHttpServer()).get('/instruments')
      .query({ query: 'bank', page: 3, pageSize: 2 });

    expect(first.status).toBe(200);
    expect(first.body.data.map((item: { ticker: string }) => item.ticker)).toEqual(['ABCD', 'BANK']);
    expect(first.body.pagination).toEqual({ page: 1, pageSize: 2, totalItems: 4, totalPages: 2 });
    expect(second.status).toBe(200);
    expect(second.body.data.map((item: { ticker: string }) => item.ticker)).toEqual(['BANK2', 'BC']);
    expect(second.body.pagination).toEqual({ page: 2, pageSize: 2, totalItems: 4, totalPages: 2 });
    expect(beyond.body).toEqual({
      data: [], pagination: { page: 3, pageSize: 2, totalItems: 4, totalPages: 2 },
    });

    const invalid = await request(app.getHttpServer()).get('/instruments').query({ query: '  ' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('reconciles FILLED trades and transfers with the latest close and weighted average cost', async () => {
    expect((await postOrder('first-purchase')).status).toBe(201);
    await prisma.marketData.create({ data: {
      instrumentId: 1, high: '12.00', low: '12.00', open: '12.00', close: '12.00',
      datetime: new Date('2026-01-03T12:00:00.000Z'),
    } });
    expect((await postOrder('second-purchase', { ...marketBuy, size: 1 })).status).toBe(201);
    expect((await postOrder('partial-sale', { ...marketBuy, side: 'SELL', size: 1 })).status).toBe(201);
    expect((await postOrder('pending-limit', {
      ...marketBuy, type: 'LIMIT', size: 1, limitPriceARS: '11.00',
    })).body.order.status).toBe('NEW');
    expect((await postOrder('rejected-sale', { ...marketBuy, side: 'SELL', size: 3 })).body.order.status).toBe('REJECTED');
    await prisma.cashMovement.createMany({ data: [
      { userId: 1, side: 'CASH_OUT', amount: '5.00', status: 'FILLED' },
      { userId: 1, side: 'CASH_IN', amount: '7.00', status: 'FILLED' },
      { userId: 1, side: 'CASH_IN', amount: '50.00', status: 'NEW' },
    ] });

    const [movements] = await prisma.$queryRaw<Array<{
      movementCount: number; shares: number; cash: { toFixed(digits: number): string };
    }>>`
      SELECT COUNT(*)::int AS "movementCount", SUM(share_delta)::int AS shares,
             SUM(cash_delta_ars) AS cash
      FROM portfolio_movements WHERE user_id = 1
    `;
    expect(movements.movementCount).toBe(6);
    expect(movements.shares).toBe(2);
    expect(movements.cash.toFixed(2)).toBe('81.50');

    const response = await portfolio();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      userId: 1,
      totalValueARS: '105.50',
      availableCashARS: '81.50',
      positions: [{
        instrumentId: 1, ticker: 'TEST', name: 'Test share', size: 2,
        marketValueARS: '24.00', totalReturnPct: '10.77',
      }],
    });
  });

  it('allows only the owner to cancel a NEW order and rejects other statuses', async () => {
    await prisma.user.create({ data: { email: 'other-owner@example.com', accountNumber: 'other-owner' } });
    const pending = await postOrder('owner-pending', {
      ...marketBuy, type: 'LIMIT', limitPriceARS: '10.00',
    });
    const filled = await postOrder('owner-filled');
    const rejected = await postOrder('owner-rejected', { ...marketBuy, size: 10 });
    const cancel = (orderId: number, userId: number) => request(app.getHttpServer())
      .post(`/orders/${orderId}/cancel`).send({ userId });

    expect(pending.status).toBe(201);
    expect(filled.status).toBe(201);
    expect(rejected.status).toBe(422);
    expect((await cancel(pending.body.order.id, 2)).status).toBe(404);
    expect((await cancel(99999, 1)).status).toBe(404);
    expect((await prisma.order.findUnique({ where: { id: pending.body.order.id } }))?.status).toBe('NEW');

    const owned = await cancel(pending.body.order.id, 1);
    expect(owned.status).toBe(200);
    expect(owned.body.order).toMatchObject({ id: pending.body.order.id, userId: 1, status: 'CANCELLED' });
    for (const orderId of [pending.body.order.id, filled.body.order.id, rejected.body.order.id]) {
      const conflict = await cancel(orderId, 1);
      expect(conflict.status).toBe(409);
      expect(conflict.body.error.code).toBe('ORDER_NOT_CANCELLABLE');
    }
    expect((await portfolio()).body).toMatchObject({
      availableCashARS: '79.50', positions: [{ size: 2 }],
    });
  });

  it('fills a MARKET buy at the latest close and updates cash, shares, and total value', async () => {
    const submitted = await postOrder('filled');
    expect(submitted.status).toBe(201);
    expect(submitted.body.order).toMatchObject({
      userId: 1, instrumentId: 1, side: 'BUY', type: 'MARKET',
      size: 2, priceARS: '10.25', status: 'FILLED', rejectionReason: null,
    });
    expect(await prisma.order.findUnique({ where: { id: submitted.body.order.id } })).toMatchObject({
      size: 2, status: 'FILLED',
    });
    expect((await portfolio()).body).toEqual({
      userId: 1,
      totalValueARS: '100.00',
      availableCashARS: '79.50',
      positions: [{
        instrumentId: 1, ticker: 'TEST', name: 'Test share', size: 2,
        marketValueARS: '20.50', totalReturnPct: '0.00',
      }],
    });
  });

  it('persists insufficient cash and shares as REJECTED without changing the portfolio', async () => {
    const cash = await postOrder('cash', { ...marketBuy, size: 10 });
    const shares = await postOrder('shares', { ...marketBuy, side: 'SELL', size: 1 });
    expect(cash.status).toBe(422);
    expect(cash.body).toMatchObject({
      error: { code: 'INSUFFICIENT_CASH' },
      order: { status: 'REJECTED', rejectionReason: 'INSUFFICIENT_CASH', size: 10 },
    });
    expect(shares.status).toBe(422);
    expect(shares.body).toMatchObject({
      error: { code: 'INSUFFICIENT_SHARES' },
      order: { status: 'REJECTED', rejectionReason: 'INSUFFICIENT_SHARES', size: 1 },
    });
    const replay = await postOrder('cash', { ...marketBuy, size: 10 });
    expect(replay.status).toBe(422);
    expect(replay.text).toBe(cash.text);
    expect(await prisma.order.findMany({ orderBy: { id: 'asc' }, select: { status: true, rejectionReason: true } })).toEqual([
      { status: 'REJECTED', rejectionReason: 'INSUFFICIENT_CASH' },
      { status: 'REJECTED', rejectionReason: 'INSUFFICIENT_SHARES' },
    ]);
    expect((await portfolio()).body).toMatchObject({
      totalValueARS: '100.00', availableCashARS: '100.00', positions: [],
    });
  });

  it('converts an ARS amount to whole shares using the applicable MARKET or LIMIT price', async () => {
    const market = await postOrder('amount-market', {
      ...marketBuy, size: undefined, amountARS: '30.74',
    });
    expect(market.status).toBe(201);
    expect(market.body.order).toMatchObject({ size: 2, priceARS: '10.25', status: 'FILLED' });

    const limit = await postOrder('amount-limit', {
      ...marketBuy, type: 'LIMIT', size: undefined, amountARS: '17.99', limitPriceARS: '8.00',
    });
    expect(limit.status).toBe(201);
    expect(limit.body.order).toMatchObject({ size: 2, priceARS: '8.00', status: 'NEW' });
    expect((await portfolio()).body).toMatchObject({
      availableCashARS: '79.50', positions: [{ size: 2 }],
    });
  });

  it('replays the stored response after cancellation and rejects changed payloads', async () => {
    const body = { ...marketBuy, type: 'LIMIT', limitPriceARS: '10.00' };
    const first = await postOrder('same-key', body);
    expect(first.status).toBe(201);
    expect(first.body.order.status).toBe('NEW');

    const cancelled = await request(app.getHttpServer())
      .post(`/orders/${first.body.order.id}/cancel`).send({ userId: 1 });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.order.status).toBe('CANCELLED');

    const replay = await postOrder('same-key', body);
    expect(replay.status).toBe(201);
    expect(replay.text).toBe(first.text);
    expect((await prisma.order.findUnique({ where: { id: first.body.order.id } }))?.status).toBe('CANCELLED');
    expect((await prisma.idempotencyRequest.findFirst({ where: { key: 'same-key' } }))?.responseBody).toBe(first.text);

    const conflict = await postOrder('same-key', { ...body, size: 3 });
    expect(conflict.status).toBe(409);
    expect(conflict.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.idempotencyRequest.count()).toBe(1);
  });

  it('returns one response and one order for simultaneous same-key requests', async () => {
    const [first, replay] = await Promise.all([
      postOrder('concurrent-key'), postOrder('concurrent-key'),
    ]);
    expect([first.status, replay.status]).toEqual([201, 201]);
    expect(replay.text).toBe(first.text);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.idempotencyRequest.count()).toBe(1);
  });

  it('serializes concurrent buys against one cash balance', async () => {
    const [first, second] = await Promise.all([
      postOrder('first-buy', { ...marketBuy, size: 8 }),
      postOrder('second-buy', { ...marketBuy, size: 8 }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 422]);
    expect(await prisma.order.groupBy({ by: ['status'], _count: { _all: true } })).toEqual(expect.arrayContaining([
      expect.objectContaining({ status: 'FILLED', _count: { _all: 1 } }),
      expect.objectContaining({ status: 'REJECTED', _count: { _all: 1 } }),
    ]));
    expect((await portfolio()).body).toMatchObject({
      totalValueARS: '100.00', availableCashARS: '18.00', positions: [{ size: 8, marketValueARS: '82.00' }],
    });
  });

  it('rolls back both the order and idempotency key when the snapshot write fails', async () => {
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION fail_test_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'forced test snapshot failure';
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER fail_test_snapshot BEFORE INSERT ON idempotency_requests
      FOR EACH ROW EXECUTE FUNCTION fail_test_snapshot()
    `);

    try {
      const failed = await postOrder('rollback');
      expect(failed.status).toBe(500);
      expect(await prisma.order.count()).toBe(0);
      expect(await prisma.idempotencyRequest.count()).toBe(0);
      expect((await portfolio()).body.availableCashARS).toBe('100.00');
    } finally {
      await prisma.$executeRawUnsafe('DROP TRIGGER fail_test_snapshot ON idempotency_requests');
      await prisma.$executeRawUnsafe('DROP FUNCTION fail_test_snapshot()');
    }

    const retried = await postOrder('rollback');
    expect(retried.status).toBe(201);
    expect(await prisma.order.count()).toBe(1);
    expect(await prisma.idempotencyRequest.count()).toBe(1);
  });

  it('allows only one concurrent cancellation of a NEW order', async () => {
    const submitted = await postOrder('pending', { ...marketBuy, type: 'LIMIT', limitPriceARS: '10.00' });
    const cancel = () => request(app.getHttpServer())
      .post(`/orders/${submitted.body.order.id}/cancel`).send({ userId: 1 });
    const [first, second] = await Promise.all([cancel(), cancel()]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect((await prisma.order.findUnique({ where: { id: submitted.body.order.id } }))?.status).toBe('CANCELLED');
  });
});
