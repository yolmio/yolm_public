---
title: AI Decisions — ai_probability, ai_choice, ai_score, ai_decide
description: Use ai_probability, ai_choice, ai_score, and ai_decide for classification, routing, scoring, and image decisions in SQL and server procedures.
tags:
  - sql
  - ai
  - decisions
  - classification
  - procedures
related:
  - sql/overview.md
  - procedures/server_statements.md
  - services/ai.md
  - services/solution_services.md
  - concepts/decision_tables.md
  - testing/overview.md
---

# AI Decisions

Use AI decision expressions when a model must judge text, structured context,
or an image against a question or rubric: detect refund requests,
route tickets to known teams, prioritize work, or flag damaged deliveries.
Use them in server-side SQL and ordinary procedure expressions.

## Choose the right primitive

| Need | Use |
| --- | --- |
| A known, deterministic business rule | SQL `case`, comparisons, or [decision tables](../concepts/decision_tables.md). |
| Probability that a proposition is true | `ai_probability(question, context[, profile])`. |
| One of your named outcomes | `ai_choice(question, context, options_or_enum[, profile])`. |
| A numeric assessment on your scale | `ai_score(question, context, anchors[, profile])`. |
| Several judgments sharing context, or result provenance | `ai_decide(context, questions[, options])`. |
| Prose, summaries, extraction into arbitrary JSON, or tool calls | [AI Services](../services/ai.md). |

Do not use probabilistic judgments for authorization, exact arithmetic, or rules
you can express deterministically. Select thresholds using representative
labeled examples and the cost of mistakes; provide review or escalation paths
where needed. A high model probability is not a guarantee of correctness.

## Probability, choice, and score

Questions, choice definitions, score anchors, and profile names accept ordinary
SQL expressions, including columns and procedure variables. Context accepts text
or JSON; choice/score definitions accept JSON or text containing JSON. Definitions
known at compilation are checked then; dynamic definitions are checked before
that row loads media or calls a provider. Invalid definitions fail, not fall back.

Definition text rejects duplicate keys. Constant text passed directly through
`::json` is also checked; already-built JSON and dynamic JSON casts retain ordinary
SQL JSON semantics. Only enum-name shorthand and contract versions must be
compile-time constants.

Use dynamic definitions for configurable routing or rubrics, for example with
procedure variables `routing_question`, `routing_choices`, and `routing_profile`:

```sql
select ai_choice(routing_question, body, routing_choices, routing_profile)
from db.tickets;
```

`routing_choices` contains an outcome-to-description JSON object, not an enum
name. Keep the question/rubric consistent when comparing scores across records;
changing a rubric or model can change their meaning and calibration.

### Probability filters

`ai_probability` returns a DOUBLE in `[0,1]`, not a Boolean or a JSON object.

```sql
select id
from db.tickets
where ai_probability('Does this request a refund?', body) >= 0.9;
```

It does not return metadata. Use a grouped `noul` question when you also need
the provider/model, token usage, or the full true/false distribution. `noul` is
the question-type name for a yes/no probability judgment, not SQL NULL.

### Named choices

```sql
select id,
       ai_choice('Which team should handle this?', body,
         '{"billing":"Payments and refunds","technical":"Product problems"}'::json
       ) as routing
from db.tickets;
```

Alternatively, pass the constant name of an existing enum, for example
`'ticket_team'` or `'enums.ticket_team'`. Choice returns JSON:

- `value`: the selected outcome ID, as a string, not an enum-typed SQL value.
- `probability`: probability of that selected outcome.
- `probabilities`: the complete distribution keyed by your outcome IDs.
- `confidence`, `confidence_method`, and nullable `provider_confidence`.
- `metadata`; `model` and `usage` are also scalar-result convenience fields.

Cast `routing->>'value'` to `enums.ticket_team` if your definition uses that enum.
Exact ties choose the lexicographically first ID. An optional outcome such as
`needs_review` is an ordinary choice, not a provider refusal or an error.

### Numeric scoring

```sql
select ai_score('How urgently does this need action?', body, '[
  {"id":"routine","value":0,"description":"No time constraint"},
  {"id":"today","value":50,"description":"Action needed today"},
  {"id":"critical","value":100,"description":"Immediate emergency"}
]'::json) as urgency
from db.tickets;
```

Anchors need distinct IDs and strictly increasing finite numeric values. The
JSON `value` is the probability-weighted mean in **your numeric units**, not a
level index or necessarily one of the anchors. Read it with
`(urgency->>'value')::double`.

Score also returns `probabilities`, confidence fields, metadata, and an ID-keyed
`legend` containing each anchor's `value` and `description`. There is no single
score `probability` field. Sort the legend by numeric value, not JSON key order.
Providers judge the descriptions; IDs and numeric values are used locally to
interpret their distribution. Include numbers in descriptions if the model
needs to understand them.

## Group questions and reuse one result in a procedure

`ai_decide` accepts 1–64 named questions. Each has `type`, `instructions`, and
criteria where applicable:

Grouped instructions and descriptions can be text, JSON objects, or JSON
arrays. The scalar helpers' question argument must be text.

| Type | Criteria | Answer `value` |
| --- | --- | --- |
| `noul` | Optional `true`/`false` descriptions. | Probability of true; also exposed as `probability`. |
| `choice` | Object mapping outcome IDs to descriptions or JSON null. | Selected outcome ID. |
| `score` | Numeric `{id,value,description}` anchors as above. | Expected numeric score. |

Grouped answers have the same units and confidence formulas as scalar helpers.
The result is `{"answers":{"question_id":{...}},"metadata":{...}}`.
Group questions about the same context and bind the result before reading it
repeatedly. Inside an existing server statement builder `s`:

```typescript
import { sql } from "std/sql_utils";

s.defScalar("ticket_body", sql.lit`I was charged twice. Please refund one charge.`);
s.defScalar("decision", sql`
  ai_decide(ticket_body, '{
    "refund":{"type":"noul","instructions":"Does this request a refund?"},
    "team":{"type":"choice","instructions":"Which team?","criteria":{
      "billing":"Payments and refunds","technical":"Product problems"
    }}
  }'::json)
`);
s.defScalar("refund_probability", sql`
  (decision #>> '{answers,refund,value}')::double
`);
s.defScalar("team", sql`decision #>> '{answers,team,value}'`);
s.defScalar("provider", sql`decision #>> '{metadata,provider}'`);
```

Use the usual `s.if(...)`, records, or procedure tables to act on these values.
A decision expression also works directly in a server-side procedure condition.

Evaluate before starting the short transaction that applies the decision, and
revalidate business state before writing. A rollback does not undo a provider
request or its charge. Persist a result and provenance only when the business
workflow needs an audit record or reuse, not just to invoke the API.

Separate function occurrences are separate evaluations: repeating the call in
`select` and `where` can incur two charges and produce different results. Use
an ordinary procedure binding/table or a materialized CTE to reuse a computed
result. This does not promise exactly-once inference across retries or runs.

## Probability is not confidence

For a threshold on a particular outcome, compare
`(routing #>> '{probabilities,billing}')::double`, or compare `probability` when
you mean the selected choice. Do not substitute `confidence`.

`confidence` summarizes the distribution, not the probability that
the model is correct. Its named methods are:

- `normalized_peak_v1`: `(max(p) - 1/n) / (1 - 1/n)`, clamped to `[0,1]`;
  one choice yields 1. For a yes/no answer it is `abs(2p - 1)`.
- `ordinal_dispersion_v1`: one minus expected absolute distance from the modal
  numeric anchor divided by the anchors' average absolute distance from their
  midrange, clamped to `[0,1]`. Exact mode ties use the later anchor.

`provider_confidence` is the provider's optional statistic, or JSON null. Its
meaning may differ across providers. All distributions must include every
outcome and sum to one within `1e-6`; tolerated rounding is normalized. Missing
or malformed answers are failures, not invented probabilities.

## Images: pass the blob hash, not bytes or a URL

```sql
select id,
       ai_probability('Is there visible damage?',
         json_build_object('description', body, 'photo', ai_image(photo_blob))
       ) as damage_probability
from db.tickets;
```

Pass an existing 32-byte blob hash (SQL Bytes) to `ai_image(hash)`. The
Yolm runtime loads and decrypts the system blob when the expression is active,
then sends the image to the configured provider. Do not manually load/base64
encode it in the solution. Hashes from upload, `s.createBlob`, or blob reception
can be reused. The hash/storage URL is not sent to the model.

Prebuilt references have the shape
`{"$ai_media":{"type":"image","blob":"<64 hex characters>"}}`.
`$ai_media` is reserved for blob references. Avoid this key in unrelated JSON
passed as context.

A NULL hash produces SQL NULL. With a NULL `photo_blob`,
`ai_probability('Q', ai_image(photo_blob))` skips evaluation. Inside a JSON
object, the NULL image becomes a JSON null member; the remaining context is
still evaluated. Inactive branches do not load blobs or call providers.

The built-in OpenAI adapter supports PNG/JPEG/GIF/WebP images; Jev rejects media.
The context limit is 16 media parts and 16 MiB **total**, with at most 16
megapixels per image. `ai_audio`, `ai_video`, and `ai_document` also construct
blob references, but neither built-in adapter currently supports those inputs.

## NULLs and errors

All decision functions propagate SQL NULL in context, questions, choice/score
definitions, or an explicitly supplied profile without calling a provider.
Omitting a profile uses the default; NULL does not. JSON `null` context is input,
not SQL NULL. Text context stays text even if it resembles JSON; cast to `::json`
for structured context. JSON `null` is not a valid question or rubric.

Decision functions throw on provider failure, refusal, or invalid output. One
failed row can fail a query; a grouped decision never publishes partial answers.
Use ordinary procedure `s.try(...)` for an explicit recovery path. There are no
automatic provider retries. A retry can cost money again and yield a different
answer; do not turn a failure into a fabricated zero probability.

Decision error codes include `unsupported_input`, `invalid_input`,
`invalid_response`, `provider_error`, `timeout`, `rate_limited`, and `refused`.
Query errors carry these code prefixes. Handle unknown future codes as failures.
Invalid constant definitions fail compilation. Invalid dynamic definitions throw
`invalid_input` before that row's provider call; other rows may already have run.

## Profiles, provenance, and limits

The optional profile selects a configured decision model without putting provider
credentials or endpoints in SQL. Scalar functions take a final profile string;
`ai_decide` takes a JSON options object, such as
`'{"profile":"ticket_triage","version":"1.0"}'::json`. Omit it to use the default.
Only `profile` and `version` are accepted; omitted version means `1.0`.
For a dynamic profile, use `json_build_object('profile', routing_profile)`;
you can also include `'version', '1.0'`. Dynamic options require unique constant
keys and a constant version; an opaque row-dependent options object is not
accepted. An extra `::json` cast on the constructor is allowed. A null profile
member or SQL NULL options skips evaluation, just like a NULL scalar profile.
Changing providers preserves result fields and score units, but requires retesting
calibration and application thresholds.

JSON result `metadata` includes `version`, `profile`, `profile_revision`,
`provider`, `model`, `model_revision`, and `usage`. Usage, when available, has
`input_tokens` and `output_tokens`. Unavailable revisions/usage are JSON null;
`model_revision` identifies an immutable provider revision when available.
Consumers must tolerate additive metadata fields. In a group, metadata is on
the result, not repeated on every answer.

The SQL contract permits 1–255 choices and 2–255 score anchors. Built-in Jev
supports at most ten score anchors; OpenAI requires at least two choices.
Unsupported input fails explicitly; there is no fallback to a different
provider, truncation, or dropping options to make a request fit. Keep context
small and apply deterministic eligibility filters first. Definitions have a
1-MiB ceiling and share execution byte budgets with context; do not treat that
ceiling as a usable prompt allowance.
