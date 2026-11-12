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
- Model incoming and outgoing cash transfers as CASH_IN and CASH_OUT orders.
- Provide a functional test covering order submission.

## 3. Scope

### Required

- A Node.js REST API using a framework such as Express or NestJS.
- A documented data-access approach, whether an ORM or direct SQL.
- Prices and monetary values denominated in ARS.
- Persistence of orders, including rejected orders.
- Portfolio calculations based on relevant movements in `orders`, using `size`.
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

Derive cash and holdings from pertinent `orders` movements, using the `size` column. Use FILLED orders for share quantity, market value, and total position return. Treat the ARS cash instrument as type `MONEDA`. Use the latest `marketdata.close` as the current asset price. `marketdata.previousClose` is available for daily return calculations; daily return may be included if the response contract calls for it.

### FR-02 — Instrument search

Return market instruments matching a query by ticker and/or name. Matching behavior, ordering, pagination, and treatment of the ARS cash instrument must be specified in the API contract.

### FR-03 — Submit an order

Accept a user, instrument, side (`BUY` or `SELL`), order type (`MARKET` or `LIMIT`), and either an exact whole-share quantity or a total investment amount in ARS. Do not accept fractional shares. For an amount-based order, calculate the maximum whole-share quantity that fits the amount using the applicable unit price. Define request validation for zero quantity, mutually supplied quantity and amount, and any remainder below one share.

- MARKET orders do not require a submitted price. Execute them immediately at the latest `marketdata.close`, persist them as FILLED, and update the user's positions and cash.
- LIMIT orders require a submitted limit price. Persist them as NEW; no market simulation is required.
- Reject an order that exceeds the user's available ARS for BUY or held shares for SELL. Persist it as REJECTED with the relevant values and reason if the schema supports one.
- Persist every submitted order in `orders` with its side, `size`, price, type, status, and timestamp.

Order submission and its balance/position effects must be consistent under failure. The exact transaction and concurrency strategy is a technical decision to document.

### FR-04 — Cancel an order

Permit a user to cancel only an order in NEW status. A successful cancellation changes its status to CANCELLED. Define behavior for missing orders, orders belonging to another user, and orders already FILLED, REJECTED, or CANCELLED.

### FR-05 — Cash transfers

Represent incoming transfers with side CASH_IN and outgoing transfers with side CASH_OUT. Include their applicable FILLED movements in cash calculations. The API surface for creating transfers is not specified by the brief and is an open scope question.

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

## 7. Suggested API surface

Exact routes and response shapes are implementation decisions. A compact initial shape is:

- `GET /users/:userId/portfolio`
- `GET /instruments?query=...`
- `POST /orders`
- `POST /orders/:orderId/cancel`

Because authentication is out of scope, user identity can be supplied in a route or request body for this challenge. Document the chosen convention and do not imply it provides authorization.

## 8. Acceptance criteria

- Portfolio figures reconcile with FILLED order movements and the latest available prices.
- Search finds instruments by ticker and by name.
- A valid MARKET order fills at the latest close and immediately changes the resulting portfolio.
- A valid LIMIT order remains NEW and does not fill without an explicit later mechanism.
- Insufficient cash or shares yields a persisted REJECTED order.
- Only NEW orders can become CANCELLED.
- A functional test exercises order submission, including at least one successful execution and one rejection.

## 9. Open questions and assumptions to resolve

- Which SQL dialect, constraints, and initial data should the implementation use?
- How should opening cash and positions be represented when there are no CASH_IN or prior FILLED orders?
- Do NEW LIMIT orders reserve cash or shares? The brief does not specify reservation.
- What price should determine `size` for an amount-based SELL order and for a LIMIT order?
- What is the intended formula for total position return, especially after multiple buys, partial sells, and transfers? Cost basis needs a defined method.
- Should invalid requests such as unknown users, instruments, nonpositive amounts, or missing market data be persisted as REJECTED orders or returned as validation errors before creating an order?
- Is cash transfer creation part of the API, or must existing CASH_IN/CASH_OUT rows only be included in calculations?
- Should search and portfolio responses expose daily return in addition to the required total return?

Resolve these before the affected implementation work and record consequential choices in an ADR.
