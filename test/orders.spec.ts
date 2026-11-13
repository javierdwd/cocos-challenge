import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { configureApp } from '../src/app.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { OrdersModule } from '../src/orders/orders.module.js';

interface StoredOrder {
  id: number;
  userId: number;
  instrumentId: number;
  side: 'BUY' | 'SELL';
  type: 'MARKET' | 'LIMIT';
  size: number;
  price: string;
  status: 'NEW' | 'FILLED' | 'REJECTED' | 'CANCELLED';
  datetime: Date;
  rejectionReason: string | null;
}

interface StoredRequest {
  userId: number;
  key: string;
  fingerprint: string;
  orderId: number;
  httpStatus: number;
  responseBody: string;
}

interface State {
  orders: StoredOrder[];
  requests: StoredRequest[];
}

class TransactionalDatabase {
  state: State = { orders: [], requests: [] };
  marketClose: string | null = '10.25';
  failSnapshot = false;
  lockTimeout = false;
  private tail: Promise<void> = Promise.resolve();

  reset(): void {
    this.state = { orders: [], requests: [] };
    this.marketClose = '10.25';
    this.failSnapshot = false;
    this.lockTimeout = false;
    this.tail = Promise.resolve();
  }

  async $transaction<T>(callback: (tx: unknown) => Promise<T>): Promise<T> {
    const preceding = this.tail;
    let unlock!: () => void;
    this.tail = new Promise<void>((resolve) => { unlock = resolve; });
    await preceding;
    const pending: State = structuredClone(this.state);
    try {
      const result = await callback(this.transactionClient(pending));
      this.state = pending;
      return result;
    } finally {
      unlock();
    }
  }

  private transactionClient(pending: State) {
    return {
      $executeRaw: async () => 0,
      $queryRaw: async (segments: TemplateStringsArray, ...values: unknown[]) => {
        const sql = segments.join('?');
        if (sql.includes('FOR UPDATE')) {
          if (this.lockTimeout) throw { code: 'P2010', meta: { code: '55P03' } };
          return values[0] === 7 ? [{ id: 7 }] : [];
        }
        if (sql.includes('FROM portfolio_movements')) {
          let cashCents = 10_000n;
          let shares = 0n;
          for (const order of pending.orders.filter((item) => item.status === 'FILLED')) {
            const priceCents = BigInt(order.price.replace('.', ''));
            const amount = BigInt(order.size) * priceCents;
            cashCents += order.side === 'BUY' ? -amount : amount;
            shares += order.side === 'BUY' ? BigInt(order.size) : -BigInt(order.size);
          }
          return [{ cash_ars: `${cashCents / 100n}.${(cashCents % 100n).toString().padStart(2, '0')}`, held_shares: shares }];
        }
        throw new Error(`Unexpected query: ${sql}`);
      },
      instrument: { findUnique: async ({ where }: { where: { id: number } }) => where.id === 11 ? { id: 11 } : null },
      marketData: { findFirst: async () => this.marketClose === null ? null : { close: this.marketClose } },
      idempotencyRequest: {
        findUnique: async ({ where }: { where: { userId_key: { userId: number; key: string } } }) =>
          pending.requests.find((item) => item.userId === where.userId_key.userId && item.key === where.userId_key.key) ?? null,
        create: async ({ data }: { data: StoredRequest }) => {
          if (this.failSnapshot) throw new Error('Snapshot write failed');
          pending.requests.push(data);
          return data;
        },
      },
      order: {
        create: async ({ data }: { data: Omit<StoredOrder, 'id' | 'datetime'> }) => {
          const order: StoredOrder = { ...data, id: pending.orders.length + 1, datetime: new Date('2026-11-13T12:00:00.000Z') };
          pending.orders.push(order);
          return order;
        },
      },
    };
  }
}

const database = new TransactionalDatabase();

@Global()
@Module({ providers: [{ provide: PrismaService, useValue: database }], exports: [PrismaService] })
class TestDatabaseModule {}

@Module({ imports: [TestDatabaseModule, OrdersModule] })
class TestAppModule {}

const marketBuy = { userId: 7, instrumentId: 11, side: 'BUY', type: 'MARKET', size: 2 };

function postOrder(app: INestApplication, key: string, body: Record<string, unknown> = marketBuy) {
  return request(app.getHttpServer()).post('/orders').set('Idempotency-Key', key).send(body);
}

describe('POST /orders', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await NestFactory.create(TestAppModule, { logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => database.reset());

  afterAll(async () => app.close());

  it('fills a MARKET buy at the latest close and persists a rejection without changing the balance', async () => {
    const filled = await postOrder(app, 'filled', marketBuy);
    expect(filled.status).toBe(201);
    expect(filled.body.order).toMatchObject({ id: 1, size: 2, priceARS: '10.25', status: 'FILLED', rejectionReason: null });
    expect(filled.body.order.datetime).toBe('2026-11-13T12:00:00.000Z');

    const rejected = await postOrder(app, 'rejected', { ...marketBuy, size: 8 });
    expect(rejected.status).toBe(422);
    expect(rejected.body).toMatchObject({
      error: { code: 'INSUFFICIENT_CASH' },
      order: { id: 2, size: 8, priceARS: '10.25', status: 'REJECTED', rejectionReason: 'INSUFFICIENT_CASH' },
    });
    expect(database.state.orders).toHaveLength(2);
    expect(database.state.requests).toHaveLength(2);

    const remaining = await postOrder(app, 'remaining', { ...marketBuy, size: 7 });
    expect(remaining.status).toBe(201);
    expect(remaining.body.order.status).toBe('FILLED');
  });

  it('leaves a valid LIMIT order NEW with no balance effect', async () => {
    const limit = await postOrder(app, 'limit', { ...marketBuy, type: 'LIMIT', size: 9, limitPriceARS: '10.00' });
    expect(limit.status).toBe(201);
    expect(limit.body.order).toMatchObject({ size: 9, priceARS: '10.00', status: 'NEW' });
    const market = await postOrder(app, 'market', { ...marketBuy, size: 9 });
    expect(market.status).toBe(201);
    expect(market.body.order.status).toBe('FILLED');
  });

  it('replays the exact response and rejects a changed payload for the same key', async () => {
    const first = await postOrder(app, 'repeat', marketBuy);
    database.state.orders[0].status = 'CANCELLED';
    database.marketClose = null;
    const replay = await postOrder(app, 'repeat', marketBuy);
    expect(replay.status).toBe(201);
    expect(replay.text).toBe(first.text);
    expect(database.state.orders).toHaveLength(1);

    const changed = await postOrder(app, 'repeat', { ...marketBuy, size: 3 });
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe('IDEMPOTENCY_KEY_REUSED');
  });

  it('returns one order and the same snapshot to simultaneous same-key requests', async () => {
    const [first, retry] = await Promise.all([
      postOrder(app, 'simultaneous', marketBuy),
      postOrder(app, 'simultaneous', marketBuy),
    ]);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.text).toBe(first.text);
    expect(database.state.orders).toHaveLength(1);
    expect(database.state.requests).toHaveLength(1);
  });

  it('converts an ARS amount to whole shares using the applicable price', async () => {
    const response = await postOrder(app, 'amount', { ...marketBuy, size: undefined, amountARS: '30.74' });
    expect(response.status).toBe(201);
    expect(response.body.order).toMatchObject({ size: 2, priceARS: '10.25', status: 'FILLED' });
    expect(database.state.orders[0].size).toBe(2);
  });

  it('replays a persisted rejection with its original 422 response', async () => {
    const first = await postOrder(app, 'rejected-replay', { ...marketBuy, size: 10 });
    const replay = await postOrder(app, 'rejected-replay', { ...marketBuy, size: 10 });
    expect(first.status).toBe(422);
    expect(replay.status).toBe(422);
    expect(replay.text).toBe(first.text);
    expect(database.state.orders).toHaveLength(1);
  });

  it('serializes concurrent orders against one user balance', async () => {
    const [first, second] = await Promise.all([
      postOrder(app, 'first', { ...marketBuy, size: 8 }),
      postOrder(app, 'second', { ...marketBuy, size: 8 }),
    ]);
    expect([first.status, second.status].sort()).toEqual([201, 422]);
    expect(database.state.orders.map((order) => order.status).sort()).toEqual(['FILLED', 'REJECTED']);
  });

  it('rolls back both the order and its idempotency record on a snapshot write failure', async () => {
    database.failSnapshot = true;
    const failed = await postOrder(app, 'retry', marketBuy);
    expect(failed.status).toBe(500);
    expect(database.state.orders).toHaveLength(0);
    expect(database.state.requests).toHaveLength(0);

    database.failSnapshot = false;
    const retried = await postOrder(app, 'retry', marketBuy);
    expect(retried.status).toBe(201);
    expect(database.state.orders).toHaveLength(1);
    expect(database.state.requests).toHaveLength(1);
  });

  it('returns a retryable 409 when the user row lock times out', async () => {
    database.lockTimeout = true;
    const response = await postOrder(app, 'busy', marketBuy);
    expect(response.status).toBe(409);
    expect(response.body.error.code).toBe('ORDER_RETRYABLE_CONFLICT');
    expect(database.state.orders).toHaveLength(0);
    expect(database.state.requests).toHaveLength(0);
  });

  it('persists a SELL rejected for insufficient held shares', async () => {
    const response = await postOrder(app, 'sell', { ...marketBuy, side: 'SELL' });
    expect(response.status).toBe(422);
    expect(response.body).toMatchObject({
      error: { code: 'INSUFFICIENT_SHARES' },
      order: { status: 'REJECTED', rejectionReason: 'INSUFFICIENT_SHARES' },
    });
    expect(database.state.orders).toHaveLength(1);
  });

  it('does not persist malformed, unknown, or missing-price requests', async () => {
    expect((await postOrder(app, 'bad', { ...marketBuy, size: 0 })).status).toBe(400);
    expect((await postOrder(app, 'bad-side', { ...marketBuy, side: 'TRANSFER' })).status).toBe(400);
    expect((await postOrder(app, 'bad-type', { ...marketBuy, type: 'STOP' })).status).toBe(400);
    expect((await postOrder(app, 'bad-user-id', { ...marketBuy, userId: 0 })).status).toBe(400);
    expect((await postOrder(app, 'bad-instrument-id', { ...marketBuy, instrumentId: 0 })).status).toBe(400);
    expect((await postOrder(app, 'unknown-user', { ...marketBuy, userId: 99 })).status).toBe(404);
    expect((await postOrder(app, 'unknown-instrument', { ...marketBuy, instrumentId: 99 })).status).toBe(404);
    database.marketClose = null;
    expect((await postOrder(app, 'no-price', marketBuy)).status).toBe(503);
    expect(database.state.orders).toHaveLength(0);
    expect(database.state.requests).toHaveLength(0);
  });

  it('requires an idempotency key and rejects a positive amount below one share without an order', async () => {
    const missingKey = await request(app.getHttpServer()).post('/orders').send(marketBuy);
    expect(missingKey.status).toBe(400);
    expect(missingKey.body.error.code).toBe('VALIDATION_ERROR');

    const belowShare = await postOrder(app, 'below-share', { ...marketBuy, size: undefined, amountARS: '10.24' });
    expect(belowShare.status).toBe(422);
    expect(belowShare.body.error.code).toBe('AMOUNT_BELOW_ONE_SHARE');
    expect(database.state.orders).toHaveLength(0);
    expect(database.state.requests).toHaveLength(0);
  });
});
