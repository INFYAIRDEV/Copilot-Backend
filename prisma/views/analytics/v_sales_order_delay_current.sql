SELECT
  sol.sales_order_id,
  sol.sales_order_line_id,
  sol.customer_id,
  sol.customer_code,
  sol.customer_name,
  sol.order_state,
  sol.open_qty,
  sol.unit_net_price,
  sol.currency,
  sol.approved_commitment,
  ((sol.open_qty * sol.unit_net_price)) :: numeric(18, 2) AS remaining_net_value,
  dc.as_of,
  CASE
    WHEN (
      (
        sol.order_state <> ALL (
          ARRAY ['CANCELLED'::text, 'REJECTED'::text, 'CLOSED'::text]
        )
      )
      AND (sol.open_qty > (0) :: numeric)
      AND (sol.approved_commitment IS NOT NULL)
      AND (
        (
          (sol.approved_commitment + '1 day' :: INTERVAL) AT TIME ZONE dc.reporting_timezone
        ) < dc.as_of
      )
    ) THEN TRUE
    ELSE false
  END AS is_delayed
FROM
  (
    analytics_demo.sales_order_lines sol
    CROSS JOIN analytics_demo.demo_context dc
  )
WHERE
  (dc.context_id = 'EXECUTIVE_DEMO' :: text);