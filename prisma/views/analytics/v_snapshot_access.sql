SELECT
  sm.id AS snapshot_manifest_id,
  sm.snapshot_id,
  sm.version,
  sm.dataset_id,
  sm.dataset_version,
  sm.snapshot_at,
  sm.reporting_timezone,
  sm.snapshot_type,
  sm.business_period_label,
  sm.synthetic_data,
  sm.certification_state,
  sm.source_cutoff_at,
  sm.data_quality_status,
  sm.reconciliation_status,
  sm.refresh_batch_key,
  sm.output_hash,
  sm.restated,
  sm.supersedes_snapshot_id,
  sm.supersedes_version,
  (
    EXISTS (
      SELECT
        1
      FROM
        analytics.snapshot_manifest newer
      WHERE
        (
          (newer.supersedes_snapshot_id = sm.snapshot_id)
          AND (newer.supersedes_version = sm.version)
          AND (newer.certification_state = 'CERTIFIED' :: text)
        )
    )
  ) AS is_superseded,
  TRUE AS authorization_required,
  CASE
    WHEN (sm.certification_state <> 'CERTIFIED' :: text) THEN 'NOT_CERTIFIED' :: text
    WHEN (sm.data_quality_status = 'FAIL' :: text) THEN 'BLOCKED_DATA_QUALITY' :: text
    WHEN (sm.reconciliation_status <> 'PASSED' :: text) THEN 'BLOCKED_RECONCILIATION' :: text
    WHEN (sm.output_hash IS NULL) THEN 'BLOCKED_MISSING_EVIDENCE' :: text
    WHEN (
      EXISTS (
        SELECT
          1
        FROM
          analytics.snapshot_manifest newer
        WHERE
          (
            (newer.supersedes_snapshot_id = sm.snapshot_id)
            AND (newer.supersedes_version = sm.version)
            AND (newer.certification_state = 'CERTIFIED' :: text)
          )
      )
    ) THEN 'SUPERSEDED' :: text
    ELSE 'ELIGIBLE_FOR_AUTH_CHECK' :: text
  END AS eligibility_state
FROM
  analytics.snapshot_manifest sm;