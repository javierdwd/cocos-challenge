# ADR-003: Order semantics

- Date: 2026-11-12
- Status: Accepted
- Related requirements: [Orders, portfolio, and cancellation](../PRD.md)
- GitHub issue: [#4 — Create the database schema and portfolio movement view](https://github.com/javierdwd/cocos-challenge/issues/4).

## Context and options

The brief fixes MARKET as immediately FILLED and LIMIT as NEW, but does not specify reservation, cost basis, concurrency, retries, or several error cases. We considered reserving pending resources, FIFO versus average cost, and processing concurrent submissions without or with a user-level lock.

## Decision

- NEW LIMIT orders do not reserve cash or shares. This is an explicit challenge assumption because no LIMIT execution mechanism exists. Validate resources when submitted; only FILLED movements affect cash and holdings.
- For an ARS amount, use `floor(amount / unitPrice)` whole shares for BUY or SELL. MARKET uses the latest close; LIMIT uses the submitted price. A positive amount below one share returns HTTP 422 without an order.
- Use decimal arithmetic for all prices, amounts, and cost-basis calculations; never convert them to JavaScript floating-point numbers. Do not round intermediate average costs to cents; round displayed ARS and percentages to two decimal places using half-up rounding. Encode decimal values as strings in JSON.
- Use weighted average purchase cost for the remaining position. A partial sale removes its quantity at that average cost. Total return is `(marketValue - remainingCost) / remainingCost * 100`; omit zero-share positions and return `null` if a positive position has zero cost. Realized gains are separate.
- Malformed requests return 400; unknown users or instruments return 404. A missing MARKET price returns 503. None creates an order. Insufficient cash or shares creates a REJECTED order with a reason and returns 422 with its order ID. Valid FILLED or NEW orders return 201.
- In one transaction, lock the user's row with `SELECT ... FOR UPDATE` before reading cash and holdings, then validate and persist the order. Every runtime write affecting that user's balance or holdings must use the same lock. Persist REJECTED outcomes; roll back entirely on system failure.
- Require `Idempotency-Key` on `POST /orders` (400 if missing). Store it in a separate `idempotency_requests` table, unique by user and key, with a fingerprint of the normalized method, path, and validated payload, the order ID, and the original HTTP status/body. Reusing a key for a different request returns 409. Store the idempotency row and order in the same transaction. A completed retry replays the exact response, including 201 or 422, even if the order was later cancelled. A concurrent retry waits for the first transaction and then replays; a lock timeout returns a retryable 409. Retain keys for the lifetime of the challenge database. Seed-only `cash_movements` do not need idempotency keys.
- Store the original serialized response body as text so replay preserves the exact JSON snapshot, including property order, alongside its HTTP status. The database enforces one key per user and one snapshot per order.
- Cancellation requires the user ID and changes only that user's NEW order to CANCELLED. Return 200 with the updated order; return 404 for missing or other-user orders and 409 for any non-NEW status. A conditional status update prevents two cancellations from both succeeding.

## Rationale and consequences

These rules keep pending orders inert while making executed orders, balances, and retries deterministic. Idempotency requires a persistence table; rejected orders need a stored reason. The original response snapshot is retained so a retry never changes meaning after later order state transitions. Bruno must reuse a key for retries and use a new key for each new order.

## Validation

Test a successful MARKET order, a persisted rejection, amount conversion, cancellation, same-key replay, changed-payload conflict, and two concurrent orders against one balance. Verify that a failed transaction leaves neither an order nor an idempotency record.
