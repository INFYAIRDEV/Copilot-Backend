SELECT
  a.allocation_id,
  a.sales_order_line_id,
  a.production_order_id,
  a.allocation_weight,
  sd.sales_order_id,
  sd.customer_id,
  sd.customer_code,
  sd.customer_name,
  sd.remaining_net_value AS delayed_line_backlog_value,
  ((sd.remaining_net_value * a.allocation_weight)) :: numeric(18, 2) AS allocated_backlog_value,
  a.source_open_value_eur,
  sd.is_delayed AS sales_line_is_delayed,
  pd.is_delayed AS production_order_is_delayed
FROM
  (
    (
      analytics_demo.sales_production_allocations a
      JOIN analytics.v_sales_order_delay_current sd ON ((sd.sales_order_line_id = a.sales_order_line_id))
    )
    JOIN analytics.v_production_order_delay_current pd ON ((pd.production_order_id = a.production_order_id))
  );