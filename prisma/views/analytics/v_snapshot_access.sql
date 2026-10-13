SELECT
  id AS snapshot_manifest_id,
  snapshot_id,
  version,
  dataset_id,
  dataset_version,
  snapshot_at,
  reporting_timezone,
  snapshot_type,
  business_period_label,
  synthetic_data,
  certification_state,
  source_cutoff_at,
  data_quality_status,
  reconciliation_status,
  refresh_batch_key,
  output_hash,
  restated,
  supersedes_snapshot_id,
  supersedes_version,
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
    WHEN (certification_state <> 'CERTIFIED' :: text) THEN 'NOT_CERTIFIED' :: text
    WHEN (data_quality_status = 'FAIL' :: text) THEN 'BLOCKED_DATA_QUALITY' :: text
    WHEN (reconciliation_status <> 'PASSED' :: text) THEN 'BLOCKED_RECONCILIATION' :: text
    WHEN (output_hash IS NULL) THEN 'BLOCKED_MISSING_EVIDENCE' :: text
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