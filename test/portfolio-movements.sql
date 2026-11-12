BEGIN;

INSERT INTO users (id, email, account_number)
VALUES (900001, 'schema-test@example.com', 'schema-test-900001');

INSERT INTO instruments (id, ticker, name, type)
VALUES (900001, 'TEST', 'Schema Test Share', 'SHARE');

INSERT INTO orders (id, instrument_id, user_id, side, size, price, type, status, rejection_reason)
VALUES
    (900001, 900001, 900001, 'BUY', 3, 10.25, 'MARKET', 'FILLED', NULL),
    (900002, 900001, 900001, 'SELL', 1, 12.30, 'MARKET', 'FILLED', NULL),
    (900003, 900001, 900001, 'BUY', 2, 10.25, 'LIMIT', 'NEW', NULL),
    (900004, 900001, 900001, 'SELL', 2, 10.25, 'MARKET', 'REJECTED', 'Insufficient shares'),
    (900005, 900001, 900001, 'BUY', 1, 10.25, 'LIMIT', 'CANCELLED', NULL);

INSERT INTO cash_movements (id, user_id, side, amount, status)
VALUES
    (900001, 900001, 'CASH_IN', 100.25, 'FILLED'),
    (900002, 900001, 'CASH_OUT', 5.05, 'FILLED'),
    (900003, 900001, 'CASH_IN', 50.00, 'NEW');

INSERT INTO idempotency_requests (user_id, key, fingerprint, order_id, http_status, response_body)
VALUES (900001, 'schema-test-key', 'schema-test-fingerprint', 900001, 201, '{"order":{"id":900001}}');

DO $$
DECLARE
    movement_count integer;
    total_shares integer;
    total_cash numeric;
    stored_body text;
BEGIN
    SELECT COUNT(*), SUM(share_delta), SUM(cash_delta_ars)
    INTO movement_count, total_shares, total_cash
    FROM portfolio_movements
    WHERE user_id = 900001;

    IF movement_count <> 4 OR total_shares <> 2 OR total_cash <> 76.75 THEN
        RAISE EXCEPTION 'Unexpected portfolio movements: count %, shares %, cash %',
            movement_count, total_shares, total_cash;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM portfolio_movements
        WHERE source_type = 'ORDER' AND source_id = 900001
          AND movement_type = 'BUY' AND instrument_id = 900001
          AND share_delta = 3 AND cash_delta_ars = -30.75
    ) OR NOT EXISTS (
        SELECT 1 FROM portfolio_movements
        WHERE source_type = 'ORDER' AND source_id = 900002
          AND movement_type = 'SELL' AND instrument_id = 900001
          AND share_delta = -1 AND cash_delta_ars = 12.30
    ) OR NOT EXISTS (
        SELECT 1 FROM portfolio_movements
        WHERE source_type = 'CASH_MOVEMENT' AND source_id = 900001
          AND movement_type = 'CASH_IN' AND instrument_id IS NULL
          AND share_delta = 0 AND cash_delta_ars = 100.25
    ) OR NOT EXISTS (
        SELECT 1 FROM portfolio_movements
        WHERE source_type = 'CASH_MOVEMENT' AND source_id = 900002
          AND movement_type = 'CASH_OUT' AND instrument_id IS NULL
          AND share_delta = 0 AND cash_delta_ars = -5.05
    ) THEN
        RAISE EXCEPTION 'Incorrect signed movement row';
    END IF;

    SELECT response_body INTO stored_body FROM idempotency_requests
    WHERE user_id = 900001 AND key = 'schema-test-key';
    IF stored_body <> '{"order":{"id":900001}}' THEN
        RAISE EXCEPTION 'Response snapshot changed';
    END IF;

    BEGIN
        INSERT INTO idempotency_requests (user_id, key, fingerprint, order_id, http_status, response_body)
        VALUES (900001, 'schema-test-key', 'other', 900002, 201, '{}');
        RAISE EXCEPTION 'Duplicate user/key was accepted';
    EXCEPTION WHEN unique_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO orders (instrument_id, user_id, side, size, price, type, status)
        VALUES (900001, 900001, 'BUY', 0, 10.25, 'MARKET', 'FILLED');
        RAISE EXCEPTION 'Zero-size order was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO orders (instrument_id, user_id, side, size, price, type, status)
        VALUES (900001, 900001, 'SELL', 1, 10.25, 'MARKET', 'REJECTED');
        RAISE EXCEPTION 'Reasonless rejection was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;

    BEGIN
        INSERT INTO cash_movements (user_id, side, amount, status)
        VALUES (900001, 'CASH_IN', 0, 'FILLED');
        RAISE EXCEPTION 'Zero-amount cash movement was accepted';
    EXCEPTION WHEN check_violation THEN
        NULL;
    END;
END
$$;

ROLLBACK;
