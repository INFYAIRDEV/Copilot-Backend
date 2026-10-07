WITH dq AS (
  SELECT
    v_data_quality_status.asset_id,
    v_data_quality_status.asset_version,
    count(*) AS total_dq_rules,
    count(*) FILTER (
      WHERE
        (v_data_quality_status.result = 'PASS' :: text)
    ) AS passed_dq_rules,
    count(*) FILTER (
      WHERE
        (v_data_quality_status.result = 'FAIL' :: text)
    ) AS failed_dq_rules,
    count(*) FILTER (
      WHERE
        (
          (v_data_quality_status.severity = 'BLOCK' :: text)
          AND (v_data_quality_status.result = 'FAIL' :: text)
        )
    ) AS blocking_dq_failures,
    count(*) FILTER (
      WHERE
        (
          (v_data_quality_status.severity = 'WARN' :: text)
          AND (v_data_quality_status.result = 'FAIL' :: text)
        )
    ) AS warning_dq_failures
  FROM
    analytics.v_data_quality_status
  GROUP BY
    v_data_quality_status.asset_id,
    v_data_quality_status.asset_version
),
identity_summary AS (
  SELECT
    v_identity_mapping_status.source_asset AS asset_id,
    count(*) AS mapping_checks,
    count(*) FILTER (
      WHERE
        (
          v_identity_mapping_status.mapping_status = 'COMPLETE' :: text
        )
    ) AS complete_mapping_checks,
    count(*) FILTER (
      WHERE
        (
          v_identity_mapping_status.mapping_status = 'PARTIAL' :: text
        )
    ) AS partial_mapping_checks,
    count(*) FILTER (
      WHERE
        (
          v_identity_mapping_status.mapping_status = 'UNMAPPED' :: text
        )
    ) AS unmapped_mapping_checks,
    min(v_identity_mapping_status.coverage_pct) AS minimum_mapping_coverage_pct,
    jsonb_agg(
      jsonb_build_object(
        'mappingType',
        v_identity_mapping_status.mapping_type,
        'coverageBasis',
        v_identity_mapping_status.coverage_basis,
        'totalPopulation',
        v_identity_mapping_status.total_population,
        'mappedPopulation',
        v_identity_mapping_status.mapped_population,
        'unmappedPopulation',
        v_identity_mapping_status.unmapped_population,
        'coveragePct',
        v_identity_mapping_status.coverage_pct,
        'status',
        v_identity_mapping_status.mapping_status
      )
      ORDER BY
        v_identity_mapping_status.mapping_type,
        v_identity_mapping_status.coverage_basis
    ) AS mapping_evidence
  FROM
    analytics.v_identity_mapping_status
  GROUP BY
    v_identity_mapping_status.source_asset
)
SELECT
  da.asset_id,
  da.version AS asset_version,
  (
    (da.object_schema || '.' :: text) || da.object_name
  ) AS analytical_object,
  da.certification_state,
  COALESCE(dq.total_dq_rules, (0) :: bigint) AS total_dq_rules,
  COALESCE(dq.passed_dq_rules, (0) :: bigint) AS passed_dq_rules,
  COALESCE(dq.failed_dq_rules, (0) :: bigint) AS failed_dq_rules,
  COALESCE(dq.blocking_dq_failures, (0) :: bigint) AS blocking_dq_failures,
  COALESCE(dq.warning_dq_failures, (0) :: bigint) AS warning_dq_failures,
  CASE
    WHEN (
      COALESCE(dq.blocking_dq_failures, (0) :: bigint) > 0
    ) THEN 'FAIL' :: text
    WHEN (
      COALESCE(dq.warning_dq_failures, (0) :: bigint) > 0
    ) THEN 'WARN' :: text
    WHEN (COALESCE(dq.total_dq_rules, (0) :: bigint) = 0) THEN 'NOT_ASSESSED' :: text
    ELSE 'PASS' :: text
  END AS data_quality_state,
  df.batch_key,
  df.batch_type,
  df.source_cutoff_at,
  df.row_count,
  da.target_freshness_minutes,
  df.age_minutes,
  df.freshness_state,
  df.data_quality_status AS batch_data_quality_status,
  df.reconciliation_status,
  COALESCE(ids.mapping_checks, (0) :: bigint) AS mapping_checks,
  COALESCE(ids.complete_mapping_checks, (0) :: bigint) AS complete_mapping_checks,
  COALESCE(ids.partial_mapping_checks, (0) :: bigint) AS partial_mapping_checks,
  COALESCE(ids.unmapped_mapping_checks, (0) :: bigint) AS unmapped_mapping_checks,
  ids.minimum_mapping_coverage_pct,
  COALESCE(ids.mapping_evidence, '[]' :: jsonb) AS mapping_evidence,
  CASE
    WHEN (ids.asset_id IS NULL) THEN 'NOT_ASSESSED' :: text
    WHEN (ids.unmapped_mapping_checks > 0) THEN 'UNMAPPED' :: text
    WHEN (ids.partial_mapping_checks > 0) THEN 'PARTIAL' :: text
    ELSE 'COMPLETE' :: text
  END AS identity_mapping_state,
  CASE
    WHEN (da.certification_state <> 'APPROVED' :: text) THEN 'BLOCK' :: text
    WHEN (
      df.freshness_state = 'NO_SUCCESSFUL_REFRESH' :: text
    ) THEN 'BLOCK' :: text
    WHEN (
      COALESCE(dq.blocking_dq_failures, (0) :: bigint) > 0
    ) THEN 'BLOCK' :: text
    WHEN (df.data_quality_status = 'FAIL' :: text) THEN 'BLOCK' :: text
    WHEN (df.reconciliation_status = 'FAILED' :: text) THEN 'BLOCK' :: text
    WHEN (df.reconciliation_status = 'NOT_ASSESSED' :: text) THEN 'BLOCK' :: text
    WHEN (df.freshness_state = 'STALE' :: text) THEN 'WARN' :: text
    WHEN (df.freshness_state = 'UNKNOWN' :: text) THEN 'WARN' :: text
    WHEN (
      COALESCE(dq.warning_dq_failures, (0) :: bigint) > 0
    ) THEN 'WARN' :: text
    WHEN (
      COALESCE(ids.partial_mapping_checks, (0) :: bigint) > 0
    ) THEN 'WARN' :: text
    WHEN (
      COALESCE(ids.unmapped_mapping_checks, (0) :: bigint) > 0
    ) THEN 'WARN' :: text
    WHEN (
      df.freshness_state = ANY (
        ARRAY ['FIXED_SYNTHETIC'::text, 'FRESH'::text, 'NO_SLA'::text]
      )
    ) THEN 'READY' :: text
    ELSE 'WARN' :: text
  END AS trust_state
FROM
  (
    (
      (
        analytics.data_asset da
        LEFT JOIN dq ON (
          (
            (dq.asset_id = da.asset_id)
            AND (dq.asset_version = da.version)
          )
        )
      )
      LEFT JOIN analytics.v_data_freshness df ON (
        (
          (df.asset_id = da.asset_id)
          AND (df.asset_version = da.version)
        )
      )
    )
    LEFT JOIN identity_summary ids ON ((ids.asset_id = da.asset_id))
  )
WHERE
  (da.certification_state = 'APPROVED' :: text);