-- Run immediately after seeding a fresh database.
DO $$
BEGIN
    IF (SELECT COUNT(*) FROM users WHERE account_number IN ('10001', '10002', '10003', '10004')) <> 4
       OR EXISTS (SELECT 1 FROM instruments WHERE ticker = 'ARS')
       OR (SELECT COUNT(*) FROM instruments) <> 65
       OR (SELECT COUNT(*) FROM marketdata WHERE datetime = '2023-07-13T00:00:00Z'::timestamptz) <> 63
       OR (SELECT COUNT(*) FROM marketdata WHERE datetime = '2023-07-14T00:00:00Z'::timestamptz) <> 63
       OR (SELECT COUNT(*) FROM orders WHERE user_id = 1) <> 8
       OR (SELECT COUNT(*) FROM cash_movements) <> 3
    THEN
        RAISE EXCEPTION 'Seed rows do not match the expected fresh-database fixture';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM portfolio_movements AS movement
        JOIN users AS account ON account.id = movement.user_id
        WHERE account.account_number = '10002'
          AND movement.source_type = 'CASH_MOVEMENT'
          AND movement.movement_type = 'CASH_IN'
          AND movement.instrument_id IS NULL
          AND movement.share_delta = 0
          AND movement.cash_delta_ars = 1000000.00
    ) THEN
        RAISE EXCEPTION 'Opening cash is missing or has incorrect movement signs';
    END IF;

    IF EXISTS (
        SELECT 1 FROM orders
        WHERE user_id = 1 AND instrument_id = 31 AND side = 'SELL'
          AND size = 30 AND status = 'FILLED'
    ) OR EXISTS (
        SELECT 1 FROM (
            SELECT instrument_id, SUM(share_delta) AS shares
            FROM portfolio_movements WHERE user_id = 1 AND instrument_id IS NOT NULL
            GROUP BY instrument_id
        ) AS holdings WHERE shares < 0
    ) THEN
        RAISE EXCEPTION 'The invalid BMA sale or a negative holding was seeded';
    END IF;

    IF (SELECT COALESCE(SUM(cash_delta_ars), 0) FROM portfolio_movements WHERE user_id = 1) <> 707100.00
       OR (SELECT COALESCE(SUM(share_delta), 0) FROM portfolio_movements WHERE user_id = 1 AND instrument_id = 47) <> 40
       OR (SELECT COALESCE(SUM(share_delta), 0) FROM portfolio_movements WHERE user_id = 1 AND instrument_id = 31) <> 20
       OR (SELECT COALESCE(SUM(share_delta), 0) FROM portfolio_movements WHERE user_id = 1 AND instrument_id = 54) <> 500
    THEN
        RAISE EXCEPTION 'The sample portfolio does not reconcile';
    END IF;
END
$$;

-- Account 10001 has three holdings; 10002 has only opening cash.
SELECT account.account_number,
       COALESCE(SUM(movement.cash_delta_ars), 0)::numeric(18, 2) AS cash_ars,
       COALESCE(SUM(movement.share_delta), 0) AS shares
FROM users AS account
LEFT JOIN portfolio_movements AS movement ON movement.user_id = account.id
WHERE account.account_number IN ('10001', '10002', '10003', '10004')
GROUP BY account.account_number
ORDER BY account.account_number;
