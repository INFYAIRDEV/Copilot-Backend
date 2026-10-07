SELECT
  sales_transactions.transaction_id,
  sales_transactions.posting_at,
  sales_transactions.transaction_type,
  sales_transactions.customer_id,
  sales_transactions.customer_code,
  sales_transactions.customer_name,
  sales_transactions.currency,
  sales_transactions.net_amount,
  sales_transactions.fixture_window
FROM
  analytics_demo.sales_transactions
WHERE
  (
    sales_transactions.posting_status = 'POSTED' :: text
  );