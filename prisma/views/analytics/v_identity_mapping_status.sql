SELECT
  source_asset,
  mapping_type,
  coverage_basis,
  total_population,
  mapped_population,
  unmapped_population,
  coverage_pct,
  CASE
    WHEN (total_population = (0) :: numeric) THEN 'NO_POPULATION' :: text
    WHEN (coverage_pct = (100) :: numeric) THEN 'COMPLETE' :: text
    WHEN (coverage_pct > (0) :: numeric) THEN 'PARTIAL' :: text
    ELSE 'UNMAPPED' :: text
  END AS mapping_status
FROM
  analytics.v_identity_mapping_coverage;