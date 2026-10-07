SELECT
  po.production_order_id,
  po.order_state,
  po.required_good_qty,
  po.accepted_good_qty,
  po.approved_cancelled_qty,
  (
    GREATEST(
      (
        (po.required_good_qty - po.accepted_good_qty) - po.approved_cancelled_qty
      ),
      (0) :: numeric
    )
  ) :: numeric(18, 4) AS remaining_required_good_qty,
  po.governing_finish,
  po.target_source,
  dc.as_of,
  CASE
    WHEN (
      (
        po.order_state <> ALL (
          ARRAY ['COMPLETED'::text, 'CANCELLED'::text, 'CLOSED'::text]
        )
      )
      AND (
        GREATEST(
          (
            (po.required_good_qty - po.accepted_good_qty) - po.approved_cancelled_qty
          ),
          (0) :: numeric
        ) > (0) :: numeric
      )
      AND (po.governing_finish < dc.as_of)
    ) THEN TRUE
    ELSE false
  END AS is_delayed
FROM
  (
    analytics_demo.production_orders po
    CROSS JOIN analytics_demo.demo_context dc
  )
WHERE
  (dc.context_id = 'EXECUTIVE_DEMO' :: text);