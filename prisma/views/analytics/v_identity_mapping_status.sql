SELECT
  v_identity_mapping_coverage.source_asset,
  v_identity_mapping_coverage.mapping_type,
  v_identity_mapping_coverage.coverage_basis,
  v_identity_mapping_coverage.total_population,
  v_identity_mapping_coverage.mapped_population,
  v_identity_mapping_coverage.unmapped_population,
  v_identity_mapping_coverage.coverage_pct,
  CASE
    WHEN (
      v_identity_mapping_coverage.total_population = (0) :: numeric
    ) THEN 'NO_POPULATION' :: text
    WHEN (
      v_identity_mapping_coverage.coverage_pct = (100) :: numeric
    ) THEN 'COMPLETE' :: text
    WHEN (
      v_identity_mapping_coverage.coverage_pct > (0) :: numeric
    ) THEN 'PARTIAL' :: text
    ELSE 'UNMAPPED' :: text
  END AS mapping_status
FROM
  analytics.v_identity_mapping_coverage;