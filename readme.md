# FXRate

Yet another foreign exchange rate API project.

This project is based on [186526/fxrate](https://github.com/186526/fxrate) with enhancements.

It is recommended to use with [realSunyz/fxrate-web](https://github.com/realsunyz/fxrate-web).

---

## Usage

Test URL: Not Available

### Restful API v1 Usage

- `GET (/v1)/info` - show instance's details.

```typescript
type source = string;

interface result {
    status: 'ok' as string;
    sources: source[];
    version: string;
    apiVersion: 'v1';
    environment: 'production' | 'development';
}

export default result;
```

- `GET (/v1)/:source/` - show source's details.

```typescript
enum currency {
    // For example
    USD = 'USD';
}

type UTCString = string;

interface result {
    status: 'ok' as string;
    source: source;
    currency: currency[];
    date: UTCString;
}

export default result;
```

- `GET (/v1)/:source/:from(?reverse&precision&amount&fees)` - show currency's FX rates to other currency in source's db.

```typescript
// query use ?reverse means calculating how much currency is needed to obtain the $amount $from currency is needed.
// query use ?precision means get data rounded to $precision decimal place. use -1 as the flag means that getting infinite recurrent decimal.
// query use ?amount means convert from/to $amount currency.
// query use ?fees means add $fees% ftf.
interface FXRate {
    updated: UTCString;
    // number: 721.55
    // string: 721.(55)
    cash: number | string | false;
    remit: number | string | false;
    middle: number | string;
}

interface result {
    [to in keyof curreny]: FXRate;
}

return result;
```

- `GET (/v1)/:source/:from/:to(?reverse&precision&amount&fees)` - show currency's FX rates to other currency in source's db.

```typescript
type result = FXRate;

export default result;
```

- `GET (/v1)/:source/:from/:to/:type(/:amount)(?reverse&precision&amount&fees)` - show currency's FX rates to other currency in source's db.

```typescript
type result = FXRate;

export default result[type];
```

### JSONRPC v2 API Usage

Please be advised that the JSONRPC function is from the source repository without any edit. So we do not gurantee it is able to use. You can generally regard it as deprecated or broken.

Endpoint `(/v1)/jsonrpc/v2`

- `instanceInfo`

    Params: `undefined`  
     Response: Follow `GET (/v1)/info`

- `listCurrencies`

    Params:

    ```typescript
    {
        source: string;
    }
    ```

    Response: Follow `GET (/v1)/:source/`

- `listFXRates`

    Params:

    ```typescript
    {
        source: string;
        from: currency;
        precision: number = 2;
        amount: number = 100;
        fees: number = 0;
        reverse: boolean = false;
    }
    ```

    Response: Follow `GET (/v1)/:source/:from(?reverse&precision&amount&fees)`

- `getFXRates`

    Params:

    ```typescript
    {
        source: string;
        from: currency;
        to: currency;
        type: 'remit' | 'cash' | 'middle' | 'all';
        precision: number = 2;
        amount: number = 100;
        fees: number = 0;
        reverse: boolean = false;
    }
    ```

    Response: Follow `GET (/v1)/:source/:from/:to/:type(/:amount)(?reverse&precision&amount&fees)`

## Running

Environment variables for configuration:

| Variable                  | Type/Values                 | Description                                                                            | Default             |
| ------------------------- | --------------------------- | -------------------------------------------------------------------------------------- | ------------------- |
| `TURNSTILE_SECRET`        | `string`                    | Cloudflare Turnstile Secret Key used to verify tokens on the server.                   | required            |
| `SESSION_TTL_SECONDS`     | `number`                    | Session lifetime in seconds.                                                           | `300` (5 minutes)   |
| `SESSION_COOKIE_NAME`     | `string`                    | Session cookie name.                                                                   | `fxrate_sess`       |
| `SESSION_COOKIE_DOMAIN`   | `string (domain)`           | Cookie Domain attribute (e.g. `.example.com`). Leave unset for localhost.              | unset               |
| `SESSION_COOKIE_SAMESITE` | `None \| Lax \| Strict`     | Cookie SameSite attribute.                                                             | `None`              |
| `SESSION_COOKIE_SECURE`   | `1 \| 0`                    | Whether cookie has `Secure` attribute. In dev defaults to off; in prod defaults to on. | dev:`0`, prod:`1`   |
| `CORS_ORIGIN`             | `string (origin)`           | Allowed CORS origin. Must be a specific origin when using cookies (cannot be `*`).     | `*`                 |
| `PORT`                    | `number`                    | Server port (non‑Vercel).                                                              | `8080`              |
| `NODE_ENV`                | `development \| production` | Affects defaults and logs.                                                             | `development`       |
| `VERCEL`                  | `1 \| 0`                    | Run in Vercel adapter mode when `1`.                                                   | `0`                 |
| `LOG_LEVEL`               | `string`                    | If set to `error`, suppresses routine logs from fxmManager.                            | unset               |
| `HEADER_USER_AGENT`       | `string`                    | Override User‑Agent for Mastercard fetcher.                                            | a Safari UA default |

Notes:

- For cookie‑based auth in browsers, set `CORS_ORIGIN` to your exact frontend origin (e.g. `https://app.example.com`) and consider `SESSION_COOKIE_DOMAIN=.example.com` when using subdomains.
- In local HTTP development, set `SESSION_COOKIE_SECURE=0` to allow the browser to store cookies over HTTP.
- Authentication is session‑only: obtain a session by POSTing a Turnstile token to `/auth/signed`, then call APIs with `credentials: include`.

## License

```markdown
The program's code is under MIT LICENSE (SEE LICENSE IN LICENSE.MIT).

Data copyright belongs to its source (SEE LICENSE IN LICENSE.DATA).
```
