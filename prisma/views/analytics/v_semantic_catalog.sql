SELECT
  m.metric_id,
  m.display_name,
  m.description AS metric_description,
  mv.version AS metric_version,
  mv.business_definition,
  mv.grain,
  mv.unit,
  mv.aggregation,
  mv.time_mode,
  mv.formula_ast,
  mv.formula_hash,
  mv.freshness_max_age_minutes,
  ml.lineage_role,
  da.asset_id,
  da.version AS asset_version,
  da.object_schema,
  da.object_name,
  da.asset_type,
  da.grain AS asset_grain,
  da.certification_state,
  string_agg(
    DISTINCT mdr.dimension_id,
    ', ' :: text
    ORDER BY
      mdr.dimension_id
  ) AS allowed_dimensions,
  string_agg(
    DISTINCT CASE
      WHEN (st.locale = 'en' :: text) THEN st.term
      ELSE NULL :: text
    END,
    ', ' :: text
    ORDER BY
      CASE
        WHEN (st.locale = 'en' :: text) THEN st.term
        ELSE NULL :: text
      END
  ) AS english_terms,
  string_agg(
    DISTINCT CASE
      WHEN (st.locale = 'it' :: text) THEN st.term
      ELSE NULL :: text
    END,
    ', ' :: text
    ORDER BY
      CASE
        WHEN (st.locale = 'it' :: text) THEN st.term
        ELSE NULL :: text
      END
  ) AS italian_terms
FROM
  (
    (
      (
        (
          (
            analytics.metric m
            JOIN analytics.metric_version mv ON (
              (
                (mv.metric_id = m.metric_id)
                AND (mv.lifecycle_state = 'APPROVED' :: text)
              )
            )
          )
          JOIN analytics.metric_lineage ml ON (
            (
              (ml.metric_id = mv.metric_id)
              AND (ml.metric_version = mv.version)
            )
          )
        )
        JOIN analytics.data_asset da ON (
          (
            (da.asset_id = ml.asset_id)
            AND (da.version = ml.asset_version)
          )
        )
      )
      LEFT JOIN analytics.metric_dimension_rule mdr ON (
        (
          (mdr.metric_id = mv.metric_id)
          AND (mdr.metric_version = mv.version)
          AND (mdr.lifecycle_state = 'APPROVED' :: text)
        )
      )
    )
    LEFT JOIN analytics.semantic_term st ON (
      (
        (st.metric_id = m.metric_id)
        AND (st.lifecycle_state = 'APPROVED' :: text)
      )
    )
  )
WHERE
  (
    (m.lifecycle_state = 'APPROVED' :: text)
    AND (da.certification_state = 'APPROVED' :: text)
  )
GROUP BY
  m.metric_id,
  m.display_name,
  m.description,
  mv.version,
  mv.business_definition,
  mv.grain,
  mv.unit,
  mv.aggregation,
  mv.time_mode,
  mv.formula_ast,
  mv.formula_hash,
  mv.freshness_max_age_minutes,
  ml.lineage_role,
  da.asset_id,
  da.version,
  da.object_schema,
  da.object_name,
  da.asset_type,
  da.grain,
  da.certification_state;