# Product Requirements Document — Cocos Challenge Backend

| Field | Value |
| --- | --- |
| Status | Draft from challenge brief |
| Version | 0.1 |
| Last updated | 2026-11-12 |
| Product owner | Not specified |
| Target release | Not specified |

## 1. Summary

Build a Node.js REST API for a brokerage-style account. It must return a user's portfolio, search market instruments, submit buy and sell orders, and support cancellation of eligible orders. The table descriptions in the challenge are a proposed data model, not a fixed implementation.

## 2. Goals

- Expose portfolio value, available Argentine pesos (ARS), and positions with share quantity, position market value in ARS, and total return percentage.
- Search instruments by ticker and/or name.
- Submit BUY and SELL orders of type MARKET or LIMIT, persist their outcome, and update positions when an order fills.
- Allow cancellation of orders in NEW status only.
- Account for incoming and outgoing cash transfers as CASH_IN and CASH_OUT movements.
- Provide a functional test covering order submission.

## 3. Scope

### Required

- A Node.js REST API using a framework such as Express or NestJS.
- A documented data-access approach, whether an ORM or direct SQL.
- Prices and monetary values denominated in ARS.
- Persistence of orders, including rejected orders.
- Portfolio calculations based on FILLED trades in `orders` and FILLED transfers in `cash_movements`, combined by the view in [ADR-001](ADRs/adr-001-portfolio-movements.md).
- Documentation of material assumptions and design decisions.

### Optional

- A Postman, Insomnia, or REST Client collection with example requests.

### Out of scope

- User authentication.
- Simulating market activity or matching LIMIT orders.

## 4. Functional requirements

### FR-01 — Portfolio

Given a user, return:

- Total account value in ARS.
- Available cash in ARS.
- Each held asset's ticker/name, whole-share quantity, market value in ARS, and total return percentage.

Derive cash and holdings from FILLED trade and transfer movements in the portfolio view defined by [ADR-001](ADRs/adr-001-portfolio-movements.md). Use `orders.size` for share quantity and `cash_movements.amount` for transfers. The chosen seed omits the example ARS instrument; the portfolio still reports cash in ARS. Use the latest `marketdata.close` as the current asset price. Calculate total position return using weighted average purchase cost as defined in [ADR-003](ADRs/adr-003-order-semantics.md). Do not expose daily return in this challenge.

### FR-02 — Instrument search

Return shares matching a trimmed, case-insensitive substring query by ticker and/or name; reject an empty query with HTTP 400. Exclude ARS. Order by ticker ascending, then ID, and paginate with `page` (default 1) and `pageSize` (default 20, maximum 100).

### FR-03 — Submit an order

Accept a user, instrument, side (`BUY` or `SELL`), order type (`MARKET` or `LIMIT`), and either an exact whole-share quantity or a total investment amount in ARS. Do not accept fractional shares. For an amount-based order, calculate the maximum whole-share quantity that fits the amount using the applicable unit price. Reject zero quantity and mutually supplied quantity and amount with HTTP 400; a positive amount below one share returns HTTP 422 without creating an order.

- MARKET orders do not require a submitted price. Execute them immediately at the latest `marketdata.close`, persist them as FILLED, and update the user's positions and cash.
- LIMIT orders require a submitted limit price. Persist them as NEW; no market simulation is required.
- Reject an order that exceeds the user's available ARS for BUY or held shares for SELL. Persist it as REJECTED with the relevant values and a rejection reason.
- Persist every valid submission in `orders` with its side, `size`, price, type, status, and timestamp. Malformed or unprocessable requests listed in [ADR-003](ADRs/adr-003-order-semantics.md) return an error without an order.

Order submission and its balance/position effects must be consistent under failure. [ADR-003](ADRs/adr-003-order-semantics.md) defines transactions, row locking, idempotency, and error behavior.

### FR-04 — Cancel an order

Permit a user to cancel only their NEW order. A successful cancellation changes its status to CANCELLED and returns HTTP 200. Missing or other-user orders return 404; FILLED, REJECTED, or CANCELLED orders return 409. The caller supplies a user ID because authentication is out of scope.

### FR-05 — Cash transfers

Represent incoming transfers with side CASH_IN and outgoing transfers with side CASH_OUT in `cash_movements`, as decided in [ADR-001](ADRs/adr-001-portfolio-movements.md). Include their applicable FILLED movements in cash calculations. Transfers are seed data; creating transfers through the API is out of scope.

## 5. Order states

| Status | Meaning |
| --- | --- |
| NEW | A LIMIT order submitted to the market; eligible for user cancellation. |
| FILLED | An executed order; MARKET orders fill immediately. |
| REJECTED | A submitted order that fails a requirement, including insufficient ARS or shares. |
| CANCELLED | A formerly NEW order cancelled by its user. |

## 6. Data and pricing

The proposed database has these tables:

| Table | Proposed columns |
| --- | --- |
| `users` | `id`, `email`, `accountNumber` |
| `instruments` | `id`, `ticker`, `name`, `type` |
| `orders` | `id`, `instrumentId`, `userId`, `side`, `size`, `price`, `type`, `status`, `datetime` |
| `marketdata` | `id`, `instrumentId`, `high`, `low`, `open`, `close`, `previousClose`, `datetime` |

`marketdata` contains the last two days of instrument prices. Use the most recent row by `datetime` for each instrument. `close` is the latest price. If daily return is exposed, calculate it as `(close - previousClose) / previousClose * 100`, with defined behavior when `previousClose` is zero or missing. The table descriptions above come from the challenge brief. Any schema modification must be justified in an ADR and reflected in setup instructions.

The brief describes calculating from `orders.size` and modeling ARS as a MONEDA instrument. [ADR-001](ADRs/adr-001-portfolio-movements.md) records the accepted technical deviation: trades remain in `orders`, transfers move to `cash_movements`, and a view combines both for portfolio calculations. Cash and holdings behavior remains required.

## 7. API contract

- `GET /users/:userId/portfolio` returns `userId`, `totalValueARS`, `availableCashARS`, and `positions` with `instrumentId`, `ticker`, `name`, `size`, `marketValueARS`, and `totalReturnPct`.
- `GET /instruments?query=...&page=1&pageSize=20` returns `data` (matching instrument IDs, tickers, names, and types) and `pagination` (`page`, `pageSize`, `totalItems`, `totalPages`).
- `POST /orders` requires `Idempotency-Key` and a body with `userId`, `instrumentId`, `side`, `type`, exactly one of `size` or `amountARS`, and `limitPriceARS` only for LIMIT. The response contains `order`: `id`, `userId`, `instrumentId`, `side`, `type`, `size`, `priceARS`, `status`, `datetime`, and nullable `rejectionReason`.
- `POST /orders/:orderId/cancel` requires `{ "userId": number }` in the body and returns the updated `order`.

IDs and share counts are integers. All ARS amounts, prices, and percentages are decimal strings with two fractional digits; timestamps are ISO 8601 strings. Errors use `{ "error": { "code": string, "message": string } }`; persisted business rejections also include `order`. No authentication is implemented, so a caller-supplied user ID is not proof of identity. HTTP behavior and idempotent replay are defined in [ADR-003](ADRs/adr-003-order-semantics.md).

## 8. Acceptance criteria

- Portfolio figures reconcile with FILLED trade and cash movements and the latest available prices.
- Search finds instruments by ticker and by name.
- A valid MARKET order fills at the latest close and immediately changes the resulting portfolio.
- A valid LIMIT order remains NEW and does not fill without an explicit later mechanism.
- Insufficient cash or shares yields a persisted REJECTED order.
- Only NEW orders can become CANCELLED.
- A functional test exercises order submission, including at least one successful execution and one rejection.

## 9. Decisions

[ADR-001](ADRs/adr-001-portfolio-movements.md) records the chosen data model, portfolio view, and seed policy. Retained sample accounts start empty except account `10002`, which receives an opening CASH_IN. [ADR-002](ADRs/adr-002-technology-stack.md) records the stack. [ADR-003](ADRs/adr-003-order-semantics.md) records order validation, cost basis, transactions, idempotency, and cancellation behavior. Any further implementation choice that changes these contracts requires an ADR update.
