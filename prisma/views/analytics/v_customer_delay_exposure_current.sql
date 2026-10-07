SELECT
  a.customer_id,
  a.customer_code,
  a.customer_name,
  a.sales_order_id,
  a.sales_order_line_id,
  a.production_order_id,
  a.allocation_weight,
  a.delayed_line_backlog_value,
  a.allocated_backlog_value
FROM
  analytics.v_sales_production_allocation_current a
WHERE
  (
    (a.sales_line_is_delayed = TRUE)
    AND (a.production_order_is_delayed = TRUE)
  );