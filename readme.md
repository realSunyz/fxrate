# fxRate

A TypeScript service that aggregates foreign-exchange rates from Chinese banks and card networks.

> [!NOTE]
> This project is based on [186526/fxrate](https://github.com/186526/fxrate) with several enhancements.

## Feature Highlights

- Aggregates buy, sell, and mid rates from major Chinese banks and card networks.
- Flexible query parameters for amount conversion, reverse lookup, precision control, and fee adjustments.
- Built-in Cloudflare Turnstile validation and session management to protect public deployments.
- Written in TypeScript with first-class support for local development, server hosting, and Vercel serverless environments.

## Quick Start

### Prerequisites

- Node.js 18 or later
- pnpm (recommended) or npm

### Local Development

```bash
pnpm install
pnpm dev
```

## Configuration

> [!TIPS]
> Always deploy behind HTTPS and enable Cloudflare Turnstile in production to prevent potential attacks and unauthorized queries.

| Variable                  | Default                 | Description                            |
| ------------------------- | ----------------------- | -------------------------------------- |
| `PORT`                    | `8080`                  | Listening Port                         |
| `TURNSTILE_ENABLE`        | `1`                     | Enable Cloudflare Turnstile Validation |
| `TURNSTILE_SECRET`        | —                       | Turnstile Site Secret                  |
| `SESSION_TTL_SECONDS`     | `300`                   | Session Lifetime in Seconds            |
| `SESSION_COOKIE_NAME`     | `fxrate_sess`           | Name of the Session Cookie             |
| `SESSION_COOKIE_DOMAIN`   | —                       | Cookie Domain Attribute                |
| `SESSION_COOKIE_SAMESITE` | `None \| Lax \| Strict` | Cookie SameSite Attribute              |
| `SESSION_COOKIE_SECURE`   | `1 \| 0`                | Set Cookie as Secure                   |
| `CORS_ORIGIN`             | `*`                     | Allowed CORS Origin                    |

Please disable `SESSION_COOKIE_SECURE` when using HTTP in development environments.

## RESTful API

### Public Endpoints

- `GET /v1/info` — Instance metadata including available sources and build info.
- `GET /v1/:source/:from` — Rates from the given source for one currency against all others.
- `GET /v1/:source/:from/:to` — Rates for a specific currency pair.
- `GET /v1/:source/:from/:to/:type` — Single value for a specific rate type (`cash`, `remit`, `middle`, etc.).

Optional query parameters:

- `amount` — Convert a specific amount (defaults to 1 unit).
- `reverse` — Treat the query as "how much of `:from` is needed" for the amount of the target currency.
- `precision` — Control decimal places; use `-1` to return recurring decimals.
- `fees` — Include a percentage handling fee for card transactions.

### Authentication Endpoints

- `POST /v1/auth/signed` — Verify a Turnstile token and issue a session cookie.
- `POST /v1/auth/logout` — Clear the current session.

## Contributing

Issues and Pull Requests are definitely welcome!

Please make sure you have tested your code locally before submitting a PR.

## License

Source code is released under the MIT License ([LICENSE.MIT](https://github.com/realSunyz/fxrate/blob/main/LICENSE.MIT)).

Currency data remains the property of its original providers ([LICENSE.DATA](https://github.com/realSunyz/fxrate/blob/main/LICENSE.DATA)).
