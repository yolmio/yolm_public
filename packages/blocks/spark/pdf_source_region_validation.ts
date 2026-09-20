import { type Sql, sql } from "std/sql_utils";

export function pdfRegionCrop(
  region: Sql,
  renderWidth: Sql,
  renderHeight: Sql,
): Sql {
  const left = sql`greatest(0, least(${renderWidth} - 1, try_cast(floor(
    try_cast(${region}->'min'->>'x' as double) * ${renderWidth}
  ) as int)))`;
  const right = sql`greatest(${left} + 1, least(${renderWidth}, try_cast(ceil(
    try_cast(${region}->'max'->>'x' as double) * ${renderWidth}
  ) as int)))`;
  const top = sql`greatest(0, least(${renderHeight} - 1, try_cast(floor(
    (1.0 - try_cast(${region}->'max'->>'y' as double)) * ${renderHeight}
  ) as int)))`;
  const bottom = sql`greatest(${top} + 1, least(${renderHeight}, try_cast(ceil(
    (1.0 - try_cast(${region}->'min'->>'y' as double)) * ${renderHeight}
  ) as int)))`;
  return sql`json_build_object(
    'x', ${left},
    'y', ${top},
    'width', ${right} - ${left},
    'height', ${bottom} - ${top}
  )`;
}

const lowerHexHashPattern = "^[0-9a-f]{64}$";

export function pdfSourceRegionRenderValidationFailure(
  response: Sql,
  expectedSourceBlobHash: Sql,
  expectedPageNumber: Sql,
  expectedRegion: Sql,
  expectedOutputWidth: Sql,
): Sql {
  const result = sql`${response}::json->'resultJson'`;
  const imageBlobHash = sql`${result}->>'imageBlobHash'`;
  const resultRefs = sql`${response}::json->'resultRefs'`;
  return sql`case
    when (json_typeof(${result}) is distinct from 'object')
      then 'result_not_object'
    when try_cast(${result}->>'version' as int) is distinct from 1
      then 'version_not_1'
    when ${result}->>'sourceBlobHash' is distinct from ${expectedSourceBlobHash}
      then 'source_blob_hash_mismatch'
    when try_cast(${result}->>'pageNumber' as int) is distinct from
      ${expectedPageNumber}
      then 'page_number_mismatch'
    when (json_typeof(${result}->'region') is distinct from 'object')
      or (json_typeof(${result}->'region'->'min') is distinct from 'object')
      or (json_typeof(${result}->'region'->'max') is distinct from 'object')
      or coalesce(abs(try_cast(${result}->'region'->'min'->>'x' as double) -
        try_cast(${expectedRegion}->'min'->>'x' as double)) > 1e-12, true)
      or coalesce(abs(try_cast(${result}->'region'->'min'->>'y' as double) -
        try_cast(${expectedRegion}->'min'->>'y' as double)) > 1e-12, true)
      or coalesce(abs(try_cast(${result}->'region'->'max'->>'x' as double) -
        try_cast(${expectedRegion}->'max'->>'x' as double)) > 1e-12, true)
      or coalesce(abs(try_cast(${result}->'region'->'max'->>'y' as double) -
        try_cast(${expectedRegion}->'max'->>'y' as double)) > 1e-12, true)
      then 'region_mismatch'
    when try_cast(${result}->>'requestedOutputWidthPx' as int) is distinct from
      ${expectedOutputWidth}
      then 'requested_output_width_mismatch'
    when coalesce(
      try_cast(${result}->>'outputWidthPx' as int) < 1
        or try_cast(${result}->>'outputWidthPx' as int) >
          ${expectedOutputWidth},
      true
    ) then 'output_width_outside_requested_max'
    when coalesce(
      try_cast(${result}->>'outputHeightPx' as int) < 1
        or try_cast(${result}->>'outputHeightPx' as int) > 4096,
      true
    ) then 'output_height_outside_render_limit'
    when not regex.is_match(
      coalesce(${imageBlobHash}, ''), ${sql.lit(lowerHexHashPattern)}
    ) then 'image_blob_hash_not_lower_hex'
    when (json_typeof(${resultRefs}) is distinct from 'array')
      then 'result_refs_not_array'
    when (select count(*) from json.array_each(${resultRefs}) output
      where output.value->>'name' = 'image'
        and output.value->>'contentType' = 'image/png'
        and output.value->>'blobHash' = ${imageBlobHash}
        and try_cast(output.value->>'bytes' as bigint) > 0) != 1
      then 'matching_image_result_ref_count_not_1'
    else null
  end`;
}
