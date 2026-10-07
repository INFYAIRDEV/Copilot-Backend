SELECT
  'sales.transactions' :: text AS source_asset,
  'CUSTOMER_ID' :: text AS mapping_type,
  'ROW_COUNT' :: text AS coverage_basis,
  (count(*)) :: numeric AS total_population,
  (
    count(*) FILTER (
      WHERE
        (v_sales_transaction_fact.customer_id IS NOT NULL)
    )
  ) :: numeric AS mapped_population,
  (
    count(*) FILTER (
      WHERE
        (v_sales_transaction_fact.customer_id IS NULL)
    )
  ) :: numeric AS unmapped_population,
  round(
    (
      (
        100.0 * (
          count(*) FILTER (
            WHERE
              (v_sales_transaction_fact.customer_id IS NOT NULL)
          )
        ) :: numeric
      ) / (NULLIF(count(*), 0)) :: numeric
    ),
    1
  ) AS coverage_pct
FROM
  analytics.v_sales_transaction_fact
UNION
ALL
SELECT
  'procurement.supplier_transactions' :: text AS source_asset,
  'SUPPLIER_ID' :: text AS mapping_type,
  'ROW_COUNT' :: text AS coverage_basis,
  (count(*)) :: numeric AS total_population,
  (
    count(*) FILTER (
      WHERE
        (
          v_supplier_transaction_fact.supplier_id IS NOT NULL
        )
    )
  ) :: numeric AS mapped_population,
  (
    count(*) FILTER (
      WHERE
        (v_supplier_transaction_fact.supplier_id IS NULL)
    )
  ) :: numeric AS unmapped_population,
  round(
    (
      (
        100.0 * (
          count(*) FILTER (
            WHERE
              (
                v_supplier_transaction_fact.supplier_id IS NOT NULL
              )
          )
        ) :: numeric
      ) / (NULLIF(count(*), 0)) :: numeric
    ),
    1
  ) AS coverage_pct
FROM
  analytics.v_supplier_transaction_fact
UNION
ALL
SELECT
  'sales.delay.current' :: text AS source_asset,
  'CUSTOMER_ID' :: text AS mapping_type,
  'ROW_COUNT' :: text AS coverage_basis,
  (count(*)) :: numeric AS total_population,
  (
    count(*) FILTER (
      WHERE
        (
          v_sales_order_delay_current.customer_id IS NOT NULL
        )
    )
  ) :: numeric AS mapped_population,
  (
    count(*) FILTER (
      WHERE
        (v_sales_order_delay_current.customer_id IS NULL)
    )
  ) :: numeric AS unmapped_population,
  round(
    (
      (
        100.0 * (
          count(*) FILTER (
            WHERE
              (
                v_sales_order_delay_current.customer_id IS NOT NULL
              )
          )
        ) :: numeric
      ) / (NULLIF(count(*), 0)) :: numeric
    ),
    1
  ) AS coverage_pct
FROM
  analytics.v_sales_order_delay_current
WHERE
  (v_sales_order_delay_current.is_delayed = TRUE)
UNION
ALL
SELECT
  'production.sales_allocation.current' :: text AS source_asset,
  'SALES_LINE_TO_PRODUCTION' :: text AS mapping_type,
  'ROW_COUNT' :: text AS coverage_basis,
  (count(DISTINCT sd.sales_order_line_id)) :: numeric AS total_population,
  (
    count(DISTINCT sd.sales_order_line_id) FILTER (
      WHERE
        (a.sales_order_line_id IS NOT NULL)
    )
  ) :: numeric AS mapped_population,
  (
    (
      count(DISTINCT sd.sales_order_line_id) - count(DISTINCT sd.sales_order_line_id) FILTER (
        WHERE
          (a.sales_order_line_id IS NOT NULL)
      )
    )
  ) :: numeric AS unmapped_population,
  round(
    (
      (
        100.0 * (
          count(DISTINCT sd.sales_order_line_id) FILTER (
            WHERE
              (a.sales_order_line_id IS NOT NULL)
          )
        ) :: numeric
      ) / (
        NULLIF(count(DISTINCT sd.sales_order_line_id), 0)
      ) :: numeric
    ),
    1
  ) AS coverage_pct
FROM
  (
    analytics.v_sales_order_delay_current sd
    LEFT JOIN analytics_demo.sales_production_allocations a ON ((a.sales_order_line_id = sd.sales_order_line_id))
  )
WHERE
  (sd.is_delayed = TRUE)
UNION
ALL
SELECT
  'production.sales_allocation.current' :: text AS source_asset,
  'SALES_LINE_TO_PRODUCTION' :: text AS mapping_type,
  'BACKLOG_VALUE' :: text AS coverage_basis,
  sum(sd.remaining_net_value) AS total_population,
  COALESCE(
    sum((sd.remaining_net_value * a.allocation_weight)),
    (0) :: numeric
  ) AS mapped_population,
  (
    sum(sd.remaining_net_value) - COALESCE(
      sum((sd.remaining_net_value * a.allocation_weight)),
      (0) :: numeric
    )
  ) AS unmapped_population,
  round(
    (
      (
        100.0 * COALESCE(
          sum((sd.remaining_net_value * a.allocation_weight)),
          (0) :: numeric
        )
      ) / NULLIF(sum(sd.remaining_net_value), (0) :: numeric)
    ),
    1
  ) AS coverage_pct
FROM
  (
    analytics.v_sales_order_delay_current sd
    LEFT JOIN analytics_demo.sales_production_allocations a ON ((a.sales_order_line_id = sd.sales_order_line_id))
  )
WHERE
  (sd.is_delayed = TRUE)
UNION
ALL
SELECT
  'production.sales_allocation.current' :: text AS source_asset,
  'ALLOCATION_TO_SALES_LINE' :: text AS mapping_type,
  'ROW_COUNT' :: text AS coverage_basis,
  (count(*)) :: numeric AS total_population,
  (
    count(*) FILTER (
      WHERE
        (sd.sales_order_line_id IS NOT NULL)
    )
  ) :: numeric AS mapped_population,
  (
    count(*) FILTER (
      WHERE
        (sd.sales_order_line_id IS NULL)
    )
  ) :: numeric AS unmapped_population,
  round(
    (
      (
        100.0 * (
          count(*) FILTER (
            WHERE
              (sd.sales_order_line_id IS NOT NULL)
          )
        ) :: numeric
      ) / (NULLIF(count(*), 0)) :: numeric
    ),
    1
  ) AS coverage_pct
FROM
  (
    analytics_demo.sales_production_allocations a
    LEFT JOIN analytics.v_sales_order_delay_current sd ON ((sd.sales_order_line_id = a.sales_order_line_id))
  )
UNION
ALL
SELECT
  'production.sales_allocation.current' :: text AS source_asset,
  'ALLOCATION_TO_PRODUCTION_ORDER' :: text AS mapping_type,
  'ROW_COUNT' :: text AS coverage_basis,
  (count(*)) :: numeric AS total_population,
  (
    count(*) FILTER (
      WHERE
        (pd.production_order_id IS NOT NULL)
    )
  ) :: numeric AS mapped_population,
  (
    count(*) FILTER (
      WHERE
        (pd.production_order_id IS NULL)
    )
  ) :: numeric AS unmapped_population,
  round(
    (
      (
        100.0 * (
          count(*) FILTER (
            WHERE
              (pd.production_order_id IS NOT NULL)
          )
        ) :: numeric
      ) / (NULLIF(count(*), 0)) :: numeric
    ),
    1
  ) AS coverage_pct
FROM
  (
    analytics_demo.sales_production_allocations a
    LEFT JOIN analytics.v_production_order_delay_current pd ON ((pd.production_order_id = a.production_order_id))
  );