SELECT
  transaction_id,
  posting_at,
  transaction_type,
  supplier_id,
  supplier_code,
  supplier_name,
  currency,
  net_amount
FROM
  analytics_demo.supplier_transactions
WHERE
  (posting_status = 'POSTED' :: text);