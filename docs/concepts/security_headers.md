---
title: Security headers
description: Configure Content-Security-Policy, X-Frame-Options, and related security headers per Yolm app.
tags:
  - concepts
  - security
  - csp
  - headers
---

# Security headers

Every Yolm app emits a set of HTTP security headers configurable via the
`securityHeaders` field on `AppOpts`. The defaults follow Yolm's
recommended baseline (CSP + `X-Frame-Options: SAMEORIGIN`); override the
config to relax or tighten them per app.

## Defaults

If `securityHeaders` is omitted, the app uses
`{ contentSecurityPolicy: true, xFrameOptions: true }`, which expands to
the directives in
[`DEFAULT_CSP_DIRECTIVES`](../../packages/std/system.tsx) and
`X-Frame-Options: SAMEORIGIN`.

## Customizing Content-Security-Policy

Pass an object to fine-tune CSP without replacing the whole policy:

```typescript
system.app({
  ui: ...,
  securityHeaders: {
    contentSecurityPolicy: {
      additionalSources: {
        "script-src": ["https://js.stripe.com"],
        "frame-src": ["https://js.stripe.com"],
      },
      devAdditionalSources: {
        "script-src": ["'unsafe-inline'"],
      },
      reportUri: "/csp-report",
    },
    xFrameOptions: true,
  },
});
```

Fields:

- `additionalSources` — add sources to specific directives without
  replacing the defaults.
- `devAdditionalSources` — extra sources merged only when the `devCsp`
  capability is enabled (set `"devCsp": true` in `devCapabilities.json`).
  Useful for allowing `'unsafe-inline'` or `http:` during local development.
- `directives` — completely replace the default directive list (use
  sparingly).
- `reportOnly` — emit `Content-Security-Policy-Report-Only` instead of
  enforcing.
- `reportUri` — where the browser should POST violation reports.

To disable CSP entirely, set `contentSecurityPolicy: false`.

## X-Frame-Options

`xFrameOptions: true` produces `SAMEORIGIN`. Pass an object to choose:

```typescript
securityHeaders: {
  xFrameOptions: { value: "DENY" },
}
```

`ALLOW-FROM` is a legacy value that modern browsers do not consistently
implement. For an origin allowlist, prefer CSP `frame-ancestors` in
`contentSecurityPolicy`. If a legacy client still requires it, provide the
allowed origin:

```typescript
xFrameOptions: { value: "ALLOW-FROM", uri: "https://parent.example.com" }
```

## Additional response headers

Use the app-level `headers` field for other static HTTP response headers that
should be included on every response:

```typescript
system.app({
  ui: ...,
  headers: [
    { name: "X-Robots-Tag", value: "noindex" },
  ],
});
```

Configure `Content-Security-Policy` and `X-Frame-Options` through
`securityHeaders` instead of duplicating those names in `headers`.

## Related

- [Apps](./apps.md)
- [Authentication](../api/authentication.md)
