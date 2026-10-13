SELECT
  customer_id,
  customer_code,
  customer_name,
  sales_order_id,
  sales_order_line_id,
  production_order_id,
  allocation_weight,
  delayed_line_backlog_value,
  allocated_backlog_value
FROM
  analytics.v_sales_production_allocation_current a
WHERE
  (
    (sales_line_is_delayed = TRUE)
    AND (production_order_is_delayed = TRUE)
  );