SELECT
  supplier_transactions.transaction_id,
  supplier_transactions.posting_at,
  supplier_transactions.transaction_type,
  supplier_transactions.supplier_id,
  supplier_transactions.supplier_code,
  supplier_transactions.supplier_name,
  supplier_transactions.currency,
  supplier_transactions.net_amount
FROM
  analytics_demo.supplier_transactions
WHERE
  (
    supplier_transactions.posting_status = 'POSTED' :: text
  );