SELECT
  asset_id,
  asset_version,
  analytical_object,
  trust_state,
  CASE
    WHEN (
      trust_state = ANY (ARRAY ['READY'::text, 'WARN'::text])
    ) THEN TRUE
    ELSE false
  END AS may_execute,
  CASE
    WHEN (trust_state = 'READY' :: text) THEN false
    WHEN (trust_state = 'WARN' :: text) THEN TRUE
    ELSE false
  END AS warning_required,
  CASE
    WHEN (trust_state = 'BLOCK' :: text) THEN 'DATA_TRUST_GATE_FAILED' :: text
    WHEN (trust_state = 'WARN' :: text) THEN 'DATA_TRUST_WARNING' :: text
    ELSE NULL :: text
  END AS reason_code
FROM
  analytics.v_asset_trust_status;