SELECT
  v_asset_trust_status.asset_id,
  v_asset_trust_status.asset_version,
  v_asset_trust_status.analytical_object,
  v_asset_trust_status.trust_state,
  CASE
    WHEN (
      v_asset_trust_status.trust_state = ANY (ARRAY ['READY'::text, 'WARN'::text])
    ) THEN TRUE
    ELSE false
  END AS may_execute,
  CASE
    WHEN (v_asset_trust_status.trust_state = 'READY' :: text) THEN false
    WHEN (v_asset_trust_status.trust_state = 'WARN' :: text) THEN TRUE
    ELSE false
  END AS warning_required,
  CASE
    WHEN (v_asset_trust_status.trust_state = 'BLOCK' :: text) THEN 'DATA_TRUST_GATE_FAILED' :: text
    WHEN (v_asset_trust_status.trust_state = 'WARN' :: text) THEN 'DATA_TRUST_WARNING' :: text
    ELSE NULL :: text
  END AS reason_code
FROM
  analytics.v_asset_trust_status;