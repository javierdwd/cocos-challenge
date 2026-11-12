-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('MARKET', 'LIMIT');

-- CreateEnum
CREATE TYPE "MovementStatus" AS ENUM ('NEW', 'FILLED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CashMovementSide" AS ENUM ('CASH_IN', 'CASH_OUT');

-- CreateTable
CREATE TABLE "users" (
    "id" SERIAL NOT NULL,
    "email" TEXT NOT NULL,
    "account_number" TEXT NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "instruments" (
    "id" SERIAL NOT NULL,
    "ticker" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,

    CONSTRAINT "instruments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" SERIAL NOT NULL,
    "instrument_id" INTEGER NOT NULL,
    "user_id" INTEGER NOT NULL,
    "side" "OrderSide" NOT NULL,
    "size" INTEGER NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "type" "OrderType" NOT NULL,
    "status" "MovementStatus" NOT NULL,
    "datetime" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejection_reason" TEXT,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "marketdata" (
    "id" SERIAL NOT NULL,
    "instrument_id" INTEGER NOT NULL,
    "high" DECIMAL(18,2) NOT NULL,
    "low" DECIMAL(18,2) NOT NULL,
    "open" DECIMAL(18,2) NOT NULL,
    "close" DECIMAL(18,2) NOT NULL,
    "previous_close" DECIMAL(18,2),
    "datetime" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "marketdata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cash_movements" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "side" "CashMovementSide" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "MovementStatus" NOT NULL,
    "datetime" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cash_movements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_requests" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "key" TEXT NOT NULL,
    "fingerprint" TEXT NOT NULL,
    "order_id" INTEGER NOT NULL,
    "http_status" INTEGER NOT NULL,
    "response_body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_account_number_key" ON "users"("account_number");

-- CreateIndex
CREATE UNIQUE INDEX "instruments_ticker_key" ON "instruments"("ticker");

-- CreateIndex
CREATE INDEX "orders_user_id_datetime_idx" ON "orders"("user_id", "datetime");

-- CreateIndex
CREATE INDEX "orders_instrument_id_idx" ON "orders"("instrument_id");

-- CreateIndex
CREATE UNIQUE INDEX "marketdata_instrument_id_datetime_key" ON "marketdata"("instrument_id", "datetime");

-- CreateIndex
CREATE INDEX "cash_movements_user_id_datetime_idx" ON "cash_movements"("user_id", "datetime");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_requests_order_id_key" ON "idempotency_requests"("order_id");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_requests_user_id_key_key" ON "idempotency_requests"("user_id", "key");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "marketdata" ADD CONSTRAINT "marketdata_instrument_id_fkey" FOREIGN KEY ("instrument_id") REFERENCES "instruments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_requests" ADD CONSTRAINT "idempotency_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_requests" ADD CONSTRAINT "idempotency_requests_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "orders"
    ADD CONSTRAINT "orders_size_positive" CHECK ("size" > 0),
    ADD CONSTRAINT "orders_price_positive" CHECK ("price" > 0),
    ADD CONSTRAINT "orders_rejection_reason_status" CHECK (
        ("status" = 'REJECTED' AND NULLIF(BTRIM("rejection_reason"), '') IS NOT NULL)
        OR ("status" <> 'REJECTED' AND "rejection_reason" IS NULL)
    );

ALTER TABLE "cash_movements"
    ADD CONSTRAINT "cash_movements_amount_positive" CHECK ("amount" > 0);

ALTER TABLE "marketdata"
    ADD CONSTRAINT "marketdata_high_positive" CHECK ("high" > 0),
    ADD CONSTRAINT "marketdata_low_positive" CHECK ("low" > 0),
    ADD CONSTRAINT "marketdata_open_positive" CHECK ("open" > 0),
    ADD CONSTRAINT "marketdata_close_positive" CHECK ("close" > 0),
    ADD CONSTRAINT "marketdata_previous_close_nonnegative" CHECK ("previous_close" IS NULL OR "previous_close" >= 0);

ALTER TABLE "idempotency_requests"
    ADD CONSTRAINT "idempotency_requests_key_nonempty" CHECK (LENGTH("key") > 0),
    ADD CONSTRAINT "idempotency_requests_fingerprint_nonempty" CHECK (LENGTH("fingerprint") > 0),
    ADD CONSTRAINT "idempotency_requests_response_body_nonempty" CHECK (LENGTH("response_body") > 0),
    ADD CONSTRAINT "idempotency_requests_http_status" CHECK ("http_status" IN (201, 422));

CREATE VIEW "portfolio_movements" AS
SELECT
    'ORDER'::text AS "source_type",
    "id" AS "source_id",
    "user_id",
    "instrument_id",
    "side"::text AS "movement_type",
    CASE WHEN "side" = 'BUY' THEN "size" ELSE -"size" END AS "share_delta",
    CASE WHEN "side" = 'BUY' THEN -("size"::numeric * "price") ELSE "size"::numeric * "price" END AS "cash_delta_ars",
    "datetime"
FROM "orders"
WHERE "status" = 'FILLED'
UNION ALL
SELECT
    'CASH_MOVEMENT'::text AS "source_type",
    "id" AS "source_id",
    "user_id",
    NULL::integer AS "instrument_id",
    "side"::text AS "movement_type",
    0 AS "share_delta",
    CASE WHEN "side" = 'CASH_IN' THEN "amount" ELSE -"amount" END AS "cash_delta_ars",
    "datetime"
FROM "cash_movements"
WHERE "status" = 'FILLED';
