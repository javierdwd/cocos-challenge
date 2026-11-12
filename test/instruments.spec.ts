import 'reflect-metadata';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { Global, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { INestApplication } from '@nestjs/common';
import { configureApp } from '../src/app.js';
import { PrismaService } from '../src/database/prisma.service.js';
import { InstrumentsModule } from '../src/instruments/instruments.module.js';

const count = vi.fn();
const findMany = vi.fn();

@Global()
@Module({
  providers: [{ provide: PrismaService, useValue: { instrument: { count, findMany } } }],
  exports: [PrismaService],
})
class TestDatabaseModule {}

@Module({ imports: [TestDatabaseModule, InstrumentsModule] })
class TestAppModule {}

describe('GET /instruments', () => {
  let app: INestApplication;
  const instrument = { id: 19, ticker: 'BPAT', name: 'Banco Patagonia', type: 'ACCIONES' };

  beforeAll(async () => {
    app = await NestFactory.create(TestAppModule, { logger: false });
    configureApp(app);
    await app.init();
  });

  beforeEach(() => {
    count.mockReset().mockResolvedValue(1);
    findMany.mockReset().mockResolvedValue([instrument]);
  });

  afterAll(async () => {
    await app.close();
  });

  it('trims a query and searches ticker or name without case sensitivity', async () => {
    const response = await request(app.getHttpServer()).get('/instruments').query({ query: '  bAn  ' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [instrument],
      pagination: { page: 1, pageSize: 20, totalItems: 1, totalPages: 1 },
    });
    expect(count).toHaveBeenCalledWith({
      where: {
        type: 'ACCIONES',
        NOT: { ticker: { equals: 'ARS', mode: 'insensitive' } },
        OR: [
          { ticker: { contains: 'bAn', mode: 'insensitive' } },
          { name: { contains: 'bAn', mode: 'insensitive' } },
        ],
      },
    });
    expect(findMany).toHaveBeenCalledWith({
      where: count.mock.calls[0][0].where,
      select: { id: true, ticker: true, name: true, type: true },
      orderBy: [{ ticker: 'asc' }, { id: 'asc' }],
      skip: 0,
      take: 20,
    });
  });

  it('returns the selected page and full matching count', async () => {
    count.mockResolvedValue(5);

    const response = await request(app.getHttpServer())
      .get('/instruments')
      .query({ query: 'pat', page: 2, pageSize: 2 });

    expect(response.status).toBe(200);
    expect(response.body.pagination).toEqual({ page: 2, pageSize: 2, totalItems: 5, totalPages: 3 });
    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 2, take: 2 });
  });

  it('accepts pageSize 100 and reports zero pages when nothing matches', async () => {
    count.mockResolvedValue(0);
    findMany.mockResolvedValue([]);

    const response = await request(app.getHttpServer())
      .get('/instruments')
      .query({ query: 'missing', pageSize: 100 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [],
      pagination: { page: 1, pageSize: 100, totalItems: 0, totalPages: 0 },
    });
    expect(findMany.mock.calls[0][0]).toMatchObject({ skip: 0, take: 100 });
  });

  it('treats SQL wildcard characters as literal search text', async () => {
    await request(app.getHttpServer()).get('/instruments').query({ query: '%_\\' });

    expect(count.mock.calls[0][0].where.OR).toEqual([
      { ticker: { contains: '\\%\\_\\\\', mode: 'insensitive' } },
      { name: { contains: '\\%\\_\\\\', mode: 'insensitive' } },
    ]);
  });

  it.each([{}, { query: '' }, { query: '   ' }, { query: ['a', 'b'] }])(
    'rejects a missing or empty query: %j',
    async (query) => {
      const response = await request(app.getHttpServer()).get('/instruments').query(query);

      expect(response.status).toBe(400);
      expect(response.body).toEqual({
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request parameters' },
      });
      expect(count).not.toHaveBeenCalled();
    },
  );

  it.each([
    { page: 0 },
    { page: '1.5' },
    { pageSize: 0 },
    { pageSize: 101 },
    { pageSize: '1e2' },
  ])('rejects invalid pagination: %j', async (pagination) => {
    const response = await request(app.getHttpServer())
      .get('/instruments')
      .query({ query: 'a', ...pagination });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(count).not.toHaveBeenCalled();
  });

  it('returns an empty result for a page beyond Prisma offset range', async () => {
    count.mockResolvedValue(5);

    const response = await request(app.getHttpServer())
      .get('/instruments')
      .query({ query: 'a', page: 2_147_483_649, pageSize: 1 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      data: [],
      pagination: { page: 2_147_483_649, pageSize: 1, totalItems: 5, totalPages: 5 },
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('uses the error envelope and hides database details on failure', async () => {
    count.mockRejectedValue(new Error('database credentials are unavailable'));

    const response = await request(app.getHttpServer()).get('/instruments').query({ query: 'pat' });

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('uses the error envelope for an unknown route', async () => {
    const response = await request(app.getHttpServer()).get('/missing');

    expect(response.status).toBe(404);
    expect(response.body.error).toEqual({
      code: 'NOT_FOUND',
      message: 'Cannot GET /missing',
    });
  });
});
