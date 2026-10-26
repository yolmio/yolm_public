---
title: Twilio Service
description: Send SMS messages from Yolm server procedures through Twilio.
tags:
  - services
  - twilio
  - sms
related:
  - concepts/service_integrations.md
  - blocks/static_secrets.md
  - services/solution_services.md
---

# Twilio Service

`services/twilio` exports `Twilio` and a default `twilio` instance for sending
SMS messages.

```ts
import { twilio } from "services/twilio";

twilio.sendSms(s, {
  to: sql`user_phone`,
  body: sql`'Your code is ' || otp_code`,
});
```

## Configuration

`new Twilio(opts?)` accepts the following options. Each takes the value as a
SQL expression (for example ``getStaticSecret(sql.lit`NAME`)``), not a secret
name:

| Option | Type | Default static secret |
| --- | --- | --- |
| `accountSid` | `Sql` | `TWILIO_ACCOUNT_SID` |
| `authToken` | `Sql` | `TWILIO_AUTH_TOKEN` |
| `fromNumber` | `Sql` | `TWILIO_FROM_NUMBER` |

## `sendSms(s, opts)`

| Option | Type | Required | Meaning |
| --- | --- | --- | --- |
| `to` | `Sql` | Yes | Destination phone number. |
| `body` | `Sql` | Yes | SMS body. |
| `from` | `Sql` | No | Sender number. Defaults to the configured `fromNumber`. |
| `optIn` | `BooleanExpr` | No | See [External-Service Opt-In](./solution_services.md#external-service-opt-in). |

The helper posts to Twilio's Messages API and throws a procedure error unless
Twilio returns HTTP `201`.
