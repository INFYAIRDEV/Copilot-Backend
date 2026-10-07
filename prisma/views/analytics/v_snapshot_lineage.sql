SELECT
  sm.snapshot_id,
  sm.version AS snapshot_version,
  sm.snapshot_at,
  sm.dataset_id,
  sm.dataset_version,
  'ASSET' :: text AS lineage_type,
  (a.item ->> 'assetId' :: text) AS object_id,
  (a.item ->> 'assetVersion' :: text) AS object_version,
  (a.item ->> 'analyticalObject' :: text) AS analytical_object,
  ((a.item ->> 'rowCount' :: text)) :: bigint AS row_count,
  (a.item ->> 'refreshBatchKey' :: text) AS refresh_batch_key,
  (a.item ->> 'dataQualityStatus' :: text) AS data_quality_status,
  (a.item ->> 'reconciliationStatus' :: text) AS reconciliation_status
FROM
  (
    analytics.snapshot_manifest sm
    CROSS JOIN LATERAL jsonb_array_elements(sm.asset_manifest) a(item)
  )
UNION
ALL
SELECT
  sm.snapshot_id,
  sm.version AS snapshot_version,
  sm.snapshot_at,
  sm.dataset_id,
  sm.dataset_version,
  'METRIC' :: text AS lineage_type,
  (m.item ->> 'metricId' :: text) AS object_id,
  (m.item ->> 'metricVersion' :: text) AS object_version,
  NULL :: text AS analytical_object,
  NULL :: bigint AS row_count,
  sm.refresh_batch_key,
  sm.data_quality_status,
  sm.reconciliation_status
FROM
  (
    analytics.snapshot_manifest sm
    CROSS JOIN LATERAL jsonb_array_elements(sm.metric_manifest) m(item)
  );