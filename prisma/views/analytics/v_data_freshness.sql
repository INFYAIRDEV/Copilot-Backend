WITH latest_batch AS (
  SELECT
    rb.id,
    rb.batch_key,
    rb.asset_id,
    rb.asset_version,
    rb.batch_type,
    rb.started_at,
    rb.completed_at,
    rb.source_cutoff_at,
    rb.status,
    rb.row_count,
    rb.transformation_version,
    rb.data_quality_status,
    rb.reconciliation_status,
    rb.published,
    rb.notes,
    rb.created_at,
    rb.updated_at,
    row_number() OVER (
      PARTITION BY rb.asset_id,
      rb.asset_version
      ORDER BY
        rb.completed_at DESC NULLS LAST,
        rb.id DESC
    ) AS rn
  FROM
    analytics.refresh_batch rb
  WHERE
    (
      (rb.status = 'SUCCEEDED' :: text)
      AND (rb.published = TRUE)
    )
)
SELECT
  da.asset_id,
  da.version AS asset_version,
  da.object_schema,
  da.object_name,
  da.target_freshness_minutes,
  lb.id AS refresh_batch_id,
  lb.batch_key,
  lb.batch_type,
  lb.started_at,
  lb.completed_at,
  lb.source_cutoff_at,
  lb.row_count,
  lb.transformation_version,
  lb.data_quality_status,
  lb.reconciliation_status,
  CASE
    WHEN (lb.id IS NULL) THEN NULL :: numeric
    WHEN (lb.batch_type = 'SYNTHETIC' :: text) THEN NULL :: numeric
    WHEN (lb.source_cutoff_at IS NULL) THEN NULL :: numeric
    ELSE round(
      (
        EXTRACT(
          epoch
          FROM
            (NOW() - lb.source_cutoff_at)
        ) / 60.0
      ),
      1
    )
  END AS age_minutes,
  CASE
    WHEN (lb.id IS NULL) THEN 'NO_SUCCESSFUL_REFRESH' :: text
    WHEN (lb.batch_type = 'SYNTHETIC' :: text) THEN 'FIXED_SYNTHETIC' :: text
    WHEN (lb.source_cutoff_at IS NULL) THEN 'UNKNOWN' :: text
    WHEN (da.target_freshness_minutes IS NULL) THEN 'NO_SLA' :: text
    WHEN (
      NOW() <= (
        lb.source_cutoff_at + make_interval(mins = > da.target_freshness_minutes)
      )
    ) THEN 'FRESH' :: text
    ELSE 'STALE' :: text
  END AS freshness_state
FROM
  (
    analytics.data_asset da
    LEFT JOIN latest_batch lb ON (
      (
        (lb.asset_id = da.asset_id)
        AND (lb.asset_version = da.version)
        AND (lb.rn = 1)
      )
    )
  )
WHERE
  (da.certification_state = 'APPROVED' :: text);