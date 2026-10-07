WITH checks AS (
  SELECT
    'DQ-SALES-TX-001' :: text AS rule_id,
    (
      (
        (
          SELECT
            count(*) AS count
          FROM
            analytics.v_sales_transaction_fact
          WHERE
            (v_sales_transaction_fact.transaction_id IS NULL)
        )
      ) :: numeric + (
        SELECT
          COALESCE(sum((x.cnt - 1)), (0) :: numeric) AS "coalesce"
        FROM
          (
            SELECT
              v_sales_transaction_fact.transaction_id,
              count(*) AS cnt
            FROM
              analytics.v_sales_transaction_fact
            WHERE
              (
                v_sales_transaction_fact.transaction_id IS NOT NULL
              )
            GROUP BY
              v_sales_transaction_fact.transaction_id
            HAVING
              (count(*) > 1)
          ) x
      )
    ) AS failed_rows
  UNION
  ALL
  SELECT
    'DQ-SALES-TX-002' :: text,
    count(*) AS count
  FROM
    analytics.v_sales_transaction_fact
  WHERE
    (
      (v_sales_transaction_fact.posting_at IS NULL)
      OR (v_sales_transaction_fact.customer_id IS NULL)
      OR (v_sales_transaction_fact.currency IS NULL)
      OR (v_sales_transaction_fact.net_amount IS NULL)
    )
  UNION
  ALL
  SELECT
    'DQ-SALES-TX-003' :: text,
    count(*) AS count
  FROM
    analytics.v_sales_transaction_fact
  WHERE
    (
      (
        v_sales_transaction_fact.transaction_type <> ALL (ARRAY ['INVOICE'::text, 'CREDIT'::text])
      )
      OR (
        v_sales_transaction_fact.transaction_type IS NULL
      )
    )
  UNION
  ALL
  SELECT
    'DQ-SUPPLIER-TX-001' :: text,
    (
      (
        (
          SELECT
            count(*) AS count
          FROM
            analytics.v_supplier_transaction_fact
          WHERE
            (
              v_supplier_transaction_fact.transaction_id IS NULL
            )
        )
      ) :: numeric + (
        SELECT
          COALESCE(sum((x.cnt - 1)), (0) :: numeric) AS "coalesce"
        FROM
          (
            SELECT
              v_supplier_transaction_fact.transaction_id,
              count(*) AS cnt
            FROM
              analytics.v_supplier_transaction_fact
            WHERE
              (
                v_supplier_transaction_fact.transaction_id IS NOT NULL
              )
            GROUP BY
              v_supplier_transaction_fact.transaction_id
            HAVING
              (count(*) > 1)
          ) x
      )
    )
  UNION
  ALL
  SELECT
    'DQ-SUPPLIER-TX-002' :: text,
    count(*) AS count
  FROM
    analytics.v_supplier_transaction_fact
  WHERE
    (
      (v_supplier_transaction_fact.posting_at IS NULL)
      OR (v_supplier_transaction_fact.supplier_id IS NULL)
      OR (v_supplier_transaction_fact.currency IS NULL)
      OR (v_supplier_transaction_fact.net_amount IS NULL)
    )
  UNION
  ALL
  SELECT
    'DQ-SUPPLIER-TX-003' :: text,
    count(*) AS count
  FROM
    analytics.v_supplier_transaction_fact
  WHERE
    (
      (
        v_supplier_transaction_fact.transaction_type <> ALL (ARRAY ['INVOICE'::text, 'CREDIT'::text])
      )
      OR (
        v_supplier_transaction_fact.transaction_type IS NULL
      )
    )
  UNION
  ALL
  SELECT
    'DQ-SALES-DELAY-001' :: text,
    (
      (
        (
          SELECT
            count(*) AS count
          FROM
            analytics.v_sales_order_delay_current
          WHERE
            (
              v_sales_order_delay_current.sales_order_line_id IS NULL
            )
        )
      ) :: numeric + (
        SELECT
          COALESCE(sum((x.cnt - 1)), (0) :: numeric) AS "coalesce"
        FROM
          (
            SELECT
              v_sales_order_delay_current.sales_order_line_id,
              count(*) AS cnt
            FROM
              analytics.v_sales_order_delay_current
            WHERE
              (
                v_sales_order_delay_current.sales_order_line_id IS NOT NULL
              )
            GROUP BY
              v_sales_order_delay_current.sales_order_line_id
            HAVING
              (count(*) > 1)
          ) x
      )
    )
  UNION
  ALL
  SELECT
    'DQ-SALES-DELAY-002' :: text,
    count(*) AS count
  FROM
    analytics.v_sales_order_delay_current
  WHERE
    (
      (
        v_sales_order_delay_current.open_qty < (0) :: numeric
      )
      OR (
        v_sales_order_delay_current.remaining_net_value < (0) :: numeric
      )
    )
  UNION
  ALL
  SELECT
    'DQ-SALES-DELAY-003' :: text,
    count(*) AS count
  FROM
    analytics.v_sales_order_delay_current
  WHERE
    (
      (v_sales_order_delay_current.is_delayed = TRUE)
      AND (
        v_sales_order_delay_current.approved_commitment IS NULL
      )
    )
  UNION
  ALL
  SELECT
    'DQ-PROD-DELAY-001' :: text,
    (
      (
        (
          SELECT
            count(*) AS count
          FROM
            analytics.v_production_order_delay_current
          WHERE
            (
              v_production_order_delay_current.production_order_id IS NULL
            )
        )
      ) :: numeric + (
        SELECT
          COALESCE(sum((x.cnt - 1)), (0) :: numeric) AS "coalesce"
        FROM
          (
            SELECT
              v_production_order_delay_current.production_order_id,
              count(*) AS cnt
            FROM
              analytics.v_production_order_delay_current
            WHERE
              (
                v_production_order_delay_current.production_order_id IS NOT NULL
              )
            GROUP BY
              v_production_order_delay_current.production_order_id
            HAVING
              (count(*) > 1)
          ) x
      )
    )
  UNION
  ALL
  SELECT
    'DQ-PROD-DELAY-002' :: text,
    count(*) AS count
  FROM
    analytics.v_production_order_delay_current
  WHERE
    (
      v_production_order_delay_current.remaining_required_good_qty < (0) :: numeric
    )
  UNION
  ALL
  SELECT
    'DQ-PROD-DELAY-003' :: text,
    count(*) AS count
  FROM
    analytics.v_production_order_delay_current
  WHERE
    (
      (
        v_production_order_delay_current.is_delayed = TRUE
      )
      AND (
        v_production_order_delay_current.governing_finish IS NULL
      )
    )
  UNION
  ALL
  SELECT
    'DQ-ALLOC-001' :: text,
    (
      (
        (
          SELECT
            count(*) AS count
          FROM
            analytics.v_sales_production_allocation_current
          WHERE
            (
              v_sales_production_allocation_current.allocation_id IS NULL
            )
        )
      ) :: numeric + (
        SELECT
          COALESCE(sum((x.cnt - 1)), (0) :: numeric) AS "coalesce"
        FROM
          (
            SELECT
              v_sales_production_allocation_current.allocation_id,
              count(*) AS cnt
            FROM
              analytics.v_sales_production_allocation_current
            WHERE
              (
                v_sales_production_allocation_current.allocation_id IS NOT NULL
              )
            GROUP BY
              v_sales_production_allocation_current.allocation_id
            HAVING
              (count(*) > 1)
          ) x
      )
    )
  UNION
  ALL
  SELECT
    'DQ-ALLOC-002' :: text,
    count(*) AS count
  FROM
    analytics.v_sales_production_allocation_current
  WHERE
    (
      (
        v_sales_production_allocation_current.allocation_weight < (0) :: numeric
      )
      OR (
        v_sales_production_allocation_current.allocation_weight > (1) :: numeric
      )
      OR (
        v_sales_production_allocation_current.allocation_weight IS NULL
      )
    )
  UNION
  ALL
  SELECT
    'DQ-ALLOC-003' :: text,
    count(*) AS count
  FROM
    (
      SELECT
        v_sales_production_allocation_current.sales_order_line_id
      FROM
        analytics.v_sales_production_allocation_current
      GROUP BY
        v_sales_production_allocation_current.sales_order_line_id
      HAVING
        (
          abs(
            (
              sum(
                v_sales_production_allocation_current.allocation_weight
              ) - 1.0
            )
          ) > 0.000001
        )
    ) x
  UNION
  ALL
  SELECT
    'DQ-EXPOSURE-001' :: text,
    count(*) AS count
  FROM
    analytics.v_customer_delay_exposure_current
  WHERE
    (
      (
        v_customer_delay_exposure_current.customer_id IS NULL
      )
      OR (
        v_customer_delay_exposure_current.sales_order_line_id IS NULL
      )
      OR (
        v_customer_delay_exposure_current.production_order_id IS NULL
      )
    )
  UNION
  ALL
  SELECT
    'DQ-EXPOSURE-002' :: text,
    count(*) AS count
  FROM
    analytics.v_customer_delay_exposure_current
  WHERE
    (
      (
        v_customer_delay_exposure_current.allocated_backlog_value < (0) :: numeric
      )
      OR (
        v_customer_delay_exposure_current.allocated_backlog_value IS NULL
      )
    )
  UNION
  ALL
  SELECT
    'DQ-EXPOSURE-003' :: text,
    COALESCE(sum((x.cnt - 1)), (0) :: numeric) AS "coalesce"
  FROM
    (
      SELECT
        v_customer_delay_exposure_current.sales_order_line_id,
        v_customer_delay_exposure_current.production_order_id,
        count(*) AS cnt
      FROM
        analytics.v_customer_delay_exposure_current
      GROUP BY
        v_customer_delay_exposure_current.sales_order_line_id,
        v_customer_delay_exposure_current.production_order_id
      HAVING
        (count(*) > 1)
    ) x
)
SELECT
  r.rule_id,
  r.asset_id,
  r.asset_version,
  r.rule_name,
  r.rule_type,
  r.severity,
  c.failed_rows,
  CASE
    WHEN (c.failed_rows = (0) :: numeric) THEN 'PASS' :: text
    ELSE 'FAIL' :: text
  END AS result
FROM
  (
    checks c
    JOIN analytics.data_quality_rule r ON ((r.rule_id = c.rule_id))
  )
WHERE
  (r.lifecycle_state = 'APPROVED' :: text);