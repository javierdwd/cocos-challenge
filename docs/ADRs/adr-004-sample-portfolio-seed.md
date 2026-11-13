# ADR-004: Sample portfolio seed

- Date: 2026-11-13
- Status: Accepted
- Supersedes: [ADR-001](adr-001-portfolio-movements.md)
- Related requirements: [Portfolio, orders, and cash transfers](../PRD.md)
- GitHub issue: [#25 — Restore a consistent sample portfolio for account 10001](https://github.com/javierdwd/cocos-challenge/issues/25)

## Context

The challenge SQL gives account `10001` a portfolio with several trades, but its FILLED sale of 30 BMA shares follows a FILLED purchase of only 20 BMA shares. ADR-001 excluded the entire account to avoid the negative holding. As a result, a fresh `GET /users/2/portfolio` shows cash only, and no seeded account demonstrates positions, market value, or total return.

## Options

Keep the cash-only seed; retain the sample account after removing the single inconsistent trade; or create a wholly synthetic portfolio. The original trades provide a useful demonstration while preserving more of the supplied sample.

## Decision

Retain all four original users. Retain account `10001`'s original BUY and SELL orders, their statuses, prices, quantities, and chronological order, except for the FILLED MARKET sale of 30 BMA shares that would make its holding negative. Keep the original rejected sale of 100 PAMP shares, with `INSUFFICIENT_SHARES` as its required rejection reason. Convert the original naive trade and transfer timestamps from Argentina local time to UTC.

Keep the data model from ADR-001: BUY and SELL trades remain in `orders`; CASH_IN and CASH_OUT transfers are stored in `cash_movements`; only FILLED movements enter the `portfolio_movements` view. The ARS instrument remains excluded. Account `10001` retains its original ARS 1,000,000 CASH_IN and ARS 100,000 CASH_OUT. Account `10002` retains the added ARS 1,000,000 CASH_IN for local order examples. Accounts `10003` and `10004` start empty.

Keep the 65 share instruments and July 13–14, 2023 market prices from the challenge SQL. The date, missing quote field, and two-decimal conversion rules in ADR-001 remain in force. Match seeded orders by immutable fields so rerunning the seed does not recreate an order that was subsequently cancelled.

## Rationale

Removing only the contradictory trade preserves a realistic sample portfolio and lets reviewers inspect all portfolio fields immediately. The account remains consistent with the API rule that a sale cannot exceed held shares. The single removed row and the separate cash transfer representation are explicit deviations from the supplied SQL.

## Consequences and validation

On a fresh database, account `10001` has 40 PAMP, 20 BMA, and 500 METR shares; available cash is ARS 707,100.00. At the seeded latest closes, their market values are ARS 37,034.00, 30,056.00, and 114,750.00, for total account value ARS 888,940.00. The total returns are -0.45%, -2.42%, and -8.20%, respectively.

Verify the seeded row counts, signed movements, holdings, and cash with `test/seed.sql`. Verify the HTTP portfolio response against a freshly seeded PostgreSQL database. Rerunning the seed must not duplicate historical rows.
