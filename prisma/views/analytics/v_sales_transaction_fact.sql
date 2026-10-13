SELECT
  transaction_id,
  posting_at,
  transaction_type,
  customer_id,
  customer_code,
  customer_name,
  currency,
  net_amount,
  fixture_window
FROM
  analytics_demo.sales_transactions
WHERE
  (posting_status = 'POSTED' :: text);