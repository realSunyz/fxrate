# fxRate

A TypeScript service that aggregates foreign-exchange rates from Chinese banks and card networks.

> [!NOTE]
> This project is based on [186526/fxrate](https://github.com/186526/fxrate) with several enhancements.

## Features

- Aggregates buy, sell, and mid rates from major Chinese banks and card networks.
- Flexible query parameters for amount conversion, reverse lookup, precision control, and fee adjustments.
- Built-in Cloudflare Turnstile validation and session management to protect public deployments.
- Compatible with Docker and serverless platforms (e.g. Vercel).

## Quick Start

### Prerequisites

- Node.js 18 or later
- pnpm (recommended) or npm

### Local Development

```bash
pnpm install
pnpm dev
```

### Docker

```bash
docker pull sjc.vultrcr.com/seven/fxrate:latest
```

## Configuration

> [!IMPORTANT]
> Always deploy behind HTTPS and enable Cloudflare Turnstile in production to prevent potential attacks and unauthorized queries.

| Variable                  | Default                            | Description                            |
| ------------------------- | ---------------------------------- | -------------------------------------- |
| `PORT`                    | `8080`                             | Listening Port                         |
| `TURNSTILE_ENABLE`        | `1`                                | Enable Cloudflare Turnstile Validation |
| `TURNSTILE_SECRET`        | —                                  | Turnstile Site Secret                  |
| `SESSION_TTL_SECONDS`     | `300`                              | Session Lifetime in Seconds            |
| `SESSION_COOKIE_NAME`     | `__Host-fxrate-sess` <sup>\*</sup> | Name of the Session Cookie             |
| `SESSION_COOKIE_DOMAIN`   | —                                  | Cookie Domain Attribute                |
| `SESSION_COOKIE_SAMESITE` | `None \| Lax \| Strict`            | Cookie SameSite Attribute              |
| `SESSION_COOKIE_SECURE`   | `1 \| 0`                           | Set Cookie as Secure                   |
| `CORS_ORIGIN`             | `*`                                | Allowed CORS Origin                    |

- Default naming rules:  
  `SESSION_COOKIE_SECURE=1` only → `__Host-fxrate-sess`;  
  `SESSION_COOKIE_SECURE=1` with `SESSION_COOKIE_DOMAIN` → `__Secure-fxrate-sess`;  
  any other setup (including `SESSION_COOKIE_SECURE=0`) → `fxrate_sess`.  
  Providing `SESSION_COOKIE_NAME` always overrides these defaults.
- Please disable `SESSION_COOKIE_SECURE` when using HTTP in development environments.

## Usage

This project supports RESTful API.

### Public Endpoints

- `GET (/v1)/info` - show instance's details.

This endpoint is always publicly accessible and does not require authentication, even if Turnstile validation is enabled.

```typescript
interface InfoResponse {
    apiVersion: 'v1';
    environment: 'production' | 'development';
    sources: string[];
    status: 'ok';
    version: string;
}
```

- `GET (/v1)/:source/:from/:to` - show currency's FX rates to a specific currency in source's db.

```typescript
interface FXRate {
    cash: number;
    remit: number | false;
    middle: number;
    provided: boolean;
    updated: UTCString;
    error: string;
    success: boolean;
}
```

- `GET (/v1)/:source/:from` - show currency's FX rates to all other currencies in source's db.

```typescript
interface FXRateList {
    [currencyCode: string]: FXRate | string | boolean;
    error: string;
    success: boolean;
}
```

Optional query parameters:

- `amount` (number): Convert a specific amount (defaults to 100).
- `reverse` (boolean): Interpret the query as "how much of `:from` is required to obtain the amount of `:to`."
- `precision` (number): Control decimal places; use `-1` to return recurring decimals.
- `fees` (number): Apply a percentage handling fee for card transactions.

### Authentication Endpoints

- `POST /v1/auth/signed` - Verify a Turnstile token and issue a session cookie.

Query parameter: `cf-turnstile-response`, `cf_token`, or `token`.

```bash
POST /auth/signed HTTP/1.1
Host: api.example.com
Content-Type: application/json

{
  "token": "xxxx-xxxx-xxxx"
}
```

- `POST /v1/auth/logout` - Clear the current session.

Send an empty POST request to clear the cookie. The request body will be ignored.

## Contributing

Issues and Pull Requests are definitely welcome!

Please make sure you have tested your code locally before submitting a PR.

## License

Source code is released under the MIT License ([LICENSE.MIT](https://github.com/realSunyz/fxrate/blob/main/LICENSE.MIT)).

Currency data remains the property of its original providers ([LICENSE.DATA](https://github.com/realSunyz/fxrate/blob/main/LICENSE.DATA)).
