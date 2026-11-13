# ADR-001: Seed data and portfolio movements

- Date: 2026-11-12
- Status: Superseded
- Superseded by: [ADR-004](adr-004-sample-portfolio-seed.md)
- Related requirements: [Portfolio, orders, and cash transfers](../PRD.md)
- GitHub issue: [#4 — Create the database schema and portfolio movement view](https://github.com/javierdwd/cocos-challenge/issues/4).

## Context

The example SQL stores trades and cash transfers in `orders`. It also leaves sample account `10001` with -10 BMA shares from FILLED orders, despite the requirement to reject sales exceeding holdings.

## Options

Keep all movements in `orders`, or separate cash transfers from trades. Keep, correct, or exclude the inconsistent account.

## Decision

Use `orders` for BUY/SELL trades and `cash_movements` for CASH_IN/CASH_OUT transfers. Give `cash_movements` a user, side, positive `NUMERIC(18,2)` amount, status, and timestamp; do not reuse the integer share count in `orders.size` as cash. Store order and market prices as `NUMERIC(18,2)`. A database view combines FILLED movements as signed share and ARS cash changes: BUY subtracts `size * price`, SELL adds it, CASH_IN adds `amount`, and CASH_OUT subtracts it. Exclude sample account `10001`, its orders, and the ARS instrument from the seed. Seed one FILLED CASH_IN of ARS 1,000,000.00 for retained account `10002` so local order examples can buy shares; the other retained accounts start with zero cash and holdings.

Retain the challenge SQL's other three users, 65 share instruments, and its July 13–14, 2023 prices. The source has 63 quotes on each day; PGR and IRCP have none. Convert the source dates to midnight UTC timestamps. For the two July 13 quotes with missing open, high, and low, use their close to satisfy the required price columns. Monetary values are stored at the schema's two-decimal precision.

## Rationale

Trade and transfer fields can evolve independently. The view gives portfolio queries one consistent movement source. Excluding the account avoids importing contradictory holdings. With cash transfers in their own table, ARS no longer needs a row in `instruments`.

## Consequences and validation

Document the schema change from the example SQL. Verify that the view reconciles cash and holdings, that account `10002` has opening cash, and that the seed omits account `10001` and its orders. Run `test/seed.sql` after a fresh seed and `test/portfolio-movements.sql` for BUY, SELL, CASH_IN, and CASH_OUT signs.
