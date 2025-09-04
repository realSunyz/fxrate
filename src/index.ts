import process from 'node:process';
import http from 'node:http';
import axios from 'axios';
import crypto from 'node:crypto';

import esMain from 'es-main';

import rootRouter, { handler } from 'handlers.js';

import fxmManager from './fxmManager';
import { useBasic } from './fxmManager';

import getBOCFXRatesFromBOC from './FXGetter/boc';
// import getBOCHKFxRates from './FXGetter/bochk';
import getICBCFXRates from './FXGetter/icbc';
import getCIBFXRates, { getCIBHuanyuFXRates } from './FXGetter/cib';
import getCCBFXRates from './FXGetter/ccb';
import getABCFXRates from './FXGetter/abc';
import getBOCOMFXRates from './FXGetter/bocom';
import getPSBCFXRates from './FXGetter/psbc';
import getCMBFXRates from './FXGetter/cmb';
import getPBOCFXRates from './FXGetter/pboc';
import getUnionPayFXRates from './FXGetter/unionpay';
// import getJCBFXRates from './FXGetter/jcb';
// import getWiseFXRates from './FXGetter/wise';
// import getHSBCHKFXRates from './FXGetter/hsbc.hk';
import getHSBCCNFXRates from './FXGetter/hsbc.cn';
// import getHSBCAUFXRates from './FXGetter/hsbc.au';
import getCITICCNFXRates from './FXGetter/citic.cn';
// import getSPDBFXRates from './FXGetter/spdb';
// import getNCBCNFXRates from './FXGetter/ncb.cn';
// import getNCBHKFXRates from './FXGetter/ncb.hk';
// import getXIBFXRates from './FXGetter/xib';
import getPABFXRates from './FXGetter/pab';
// import getCEBFXRates from './FXGetter/ceb';

import mastercardFXM from './FXGetter/mastercard';
import visaFXM from './FXGetter/visa';
// import { RSSHandler } from './handler/rss';

const TURNSTILE_REUSE_TTL_SECONDS = Number(
    process.env.TURNSTILE_REUSE_TTL_SECONDS ?? 300,
);
type TurnstileCacheEntry = {
    exp: number;
    verify?: any;
};
const turnstileReuseCache = new Map<string, TurnstileCacheEntry>();

// Simple in-memory session store (swap to Redis for multi-instance)
const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS ?? 1800); // 30m default
const SESSION_COOKIE_NAME = String(
    process.env.SESSION_COOKIE_NAME ?? 'fxrate_sess',
);
const SESSION_COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN; // optional
const SESSION_COOKIE_SAMESITE = (process.env.SESSION_COOKIE_SAMESITE ??
    'None') as 'None' | 'Lax' | 'Strict';
const sessionStore = new Map<string, { exp: number; data?: any }>();

const parseCookies = (
    cookieHeader: string | null | undefined,
): Record<string, string> => {
    const out: Record<string, string> = {};
    if (!cookieHeader) return out;
    cookieHeader.split(';').forEach((part) => {
        const [k, ...rest] = part.trim().split('=');
        if (!k) return;
        out[k] = decodeURIComponent(rest.join('='));
    });
    return out;
};

const createSession = (data?: any) => {
    const id = crypto.randomBytes(32).toString('base64url');
    const exp = Date.now() + SESSION_TTL_SECONDS * 1000;
    sessionStore.set(id, { exp, data });
    return { id, exp };
};

const getSession = (id?: string | null) => {
    if (!id) return null;
    const s = sessionStore.get(id);
    if (!s) return null;
    if (s.exp <= Date.now()) {
        sessionStore.delete(id);
        return null;
    }
    return s;
};

// const destroySession = (id?: string | null) => {
//     if (!id) return;
//     sessionStore.delete(id);
// };

const Manager = new fxmManager({
    boc: getBOCFXRatesFromBOC,
    // bochk: getBOCHKFxRates,
    icbc: getICBCFXRates,
    cib: getCIBFXRates,
    cibHuanyu: getCIBHuanyuFXRates,
    ccb: getCCBFXRates,
    abc: getABCFXRates,
    bocom: getBOCOMFXRates,
    psbc: getPSBCFXRates,
    cmb: getCMBFXRates,
    pboc: getPBOCFXRates,
    unionpay: getUnionPayFXRates,
    // jcb: getJCBFXRates,
    // 'hsbc.hk': getHSBCHKFXRates,
    'hsbc.cn': getHSBCCNFXRates,
    // 'hsbc.au': getHSBCAUFXRates,
    'citic.cn': getCITICCNFXRates,
    // 'ncb.cn': getNCBCNFXRates,
    // 'ncb.hk': getNCBHKFXRates,
    // spdb: getSPDBFXRates,
    // xib: getXIBFXRates,
    pab: getPABFXRates,
    // ceb: getCEBFXRates,
});

Manager.registerFXM('mastercard', new mastercardFXM());
Manager.registerFXM('visa', new visaFXM());

// if (process.env.ENABLE_WISE != '0') {
//     if (process.env.WISE_TOKEN == undefined) {
//         console.error('WISE_TOKEN is not set. Use Wise Token from web.');
//         process.env.WISE_USE_TOKEN_FROM_WEB = '1';
//     }
//     Manager.registerGetter(
//         'wise',
//         getWiseFXRates(
//             process.env.WISE_SANDBOX_API == '1',
//             process.env.WISE_USE_TOKEN_FROM_WEB != '0',
//             process.env.WISE_TOKEN,
//         ),
//     );
// }

export const makeInstance = async (App: rootRouter, Manager: fxmManager) => {
    App.binding(
        '/(.*)',
        new handler('ANY', [
            async (_request, response) => {
                useBasic(response);
                response.status = 404;
            },
        ]),
    );

    App.useMappingAdapter();

    App.binding(
        '/',
        App.create('ANY', async () => '200 OK\n\n/info - Instance Info\n'),
    );

    App.binding(
        '/(.*)',
        new handler('ANY', [
            async (request, response) => {
                Manager.log(
                    `${request.ip} ${request.method} ${request.originURL}`,
                );

                // Basic headers
                response.headers.set(
                    'Content-Type',
                    `application/json; charset=utf-8`,
                );
                response.headers.set('X-Powered-By', `fxrate/latest`);
                response.headers.set(
                    'X-License',
                    'MIT, Data copyright belongs to its source. More details at <https://github.com/realSunyz/fxrate>.',
                );
                response.headers.set('X-Frame-Options', 'deny');
                response.headers.set(
                    'Referrer-Policy',
                    'no-referrer-when-downgrade',
                );
                response.headers.set(
                    'Permissions-Policy',
                    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
                );
                response.headers.set('Cache-Control', 'no-store');

                // CORS: allow credentials if CORS_ORIGIN is set
                const origin = request.headers.get('Origin');
                const allowOrigin = process.env.CORS_ORIGIN || '*';
                if (allowOrigin === '*' && origin) {
                    // Wildcard cannot work with credentials; only set wildcard if not using cookies
                    response.headers.set('Access-Control-Allow-Origin', '*');
                } else {
                    response.headers.set(
                        'Access-Control-Allow-Origin',
                        allowOrigin,
                    );
                    response.headers.set(
                        'Access-Control-Allow-Credentials',
                        'true',
                    );
                    response.headers.set('Vary', 'Origin');
                }
                response.headers.set(
                    'Access-Control-Allow-Methods',
                    'GET, POST, OPTIONS',
                );
                response.headers.set(
                    'Access-Control-Allow-Headers',
                    'Content-Type, Authorization',
                );

                // Preflight
                if (request.method === 'OPTIONS') {
                    response.status = 204;
                    response.body = '';
                    throw response; // short-circuit
                }

                try {
                    const secret = process.env.TURNSTILE_SECRET;
                    const token = request.query.get('token');

                    // Session cookie auth
                    const cookies = parseCookies(
                        request.headers.get('Cookie') ||
                            request.headers.get('cookie'),
                    );
                    const sess = getSession(cookies[SESSION_COOKIE_NAME]);
                    if (sess) {
                        (request as any).custom = (request as any).custom || {};
                        (request as any).custom.turnstile = { success: true };
                        response.headers.set('X-Session', 'valid');
                        return; // already authenticated via session
                    }

                    // Token-based auth remains supported (for backwards compatibility)
                    if (token)
                        response.headers.set(
                            'X-Turnstile-Token-Present',
                            'true',
                        );
                    if (!secret)
                        response.headers.set(
                            'X-Turnstile-Validation',
                            'skipped-missing-secret',
                        );

                    if (token && secret) {
                        const now = Date.now();
                        const cached = turnstileReuseCache.get(token);
                        if (
                            cached &&
                            cached.exp > now &&
                            cached.verify?.success === true
                        ) {
                            (request as any).custom =
                                (request as any).custom || {};
                            (request as any).custom.turnstile = cached.verify;

                            response.headers.set(
                                'X-Turnstile-Validation',
                                'passed-cached',
                            );
                            if (cached.verify?.challenge_ts)
                                response.headers.set(
                                    'X-Turnstile-Challenge-TS',
                                    String(cached.verify.challenge_ts),
                                );
                            if (cached.verify?.hostname)
                                response.headers.set(
                                    'X-Turnstile-Hostname',
                                    String(cached.verify.hostname),
                                );
                            if (cached.verify?.action)
                                response.headers.set(
                                    'X-Turnstile-Action',
                                    String(cached.verify.action),
                                );
                            response.headers.set(
                                'X-Turnstile-Reuse-Until',
                                new Date(cached.exp).toISOString(),
                            );
                            response.headers.set(
                                'X-Turnstile-Reusable',
                                'enabled',
                            );
                            return;
                        }
                        const form = new URLSearchParams();
                        form.set('secret', secret);
                        form.set('response', token);
                        if (request.ip) form.set('remoteip', request.ip);

                        const verify = await axios
                            .post(
                                'https://challenges.cloudflare.com/turnstile/v0/siteverify',
                                form,
                                {
                                    headers: {
                                        'Content-Type':
                                            'application/x-www-form-urlencoded',
                                        'User-Agent': 'fxrate/turnstile-verify',
                                    },
                                    timeout: 5000,
                                },
                            )
                            .then((r) => r.data)
                            .catch((e) => ({
                                success: false,
                                error: e?.message ?? 'request_error',
                            }));

                        (request as any).custom = (request as any).custom || {};
                        (request as any).custom.turnstile = verify;

                        if (verify?.success === true) {
                            response.headers.set(
                                'X-Turnstile-Validation',
                                'passed',
                            );
                            if (verify?.challenge_ts)
                                response.headers.set(
                                    'X-Turnstile-Challenge-TS',
                                    String(verify.challenge_ts),
                                );
                            if (verify?.hostname)
                                response.headers.set(
                                    'X-Turnstile-Hostname',
                                    String(verify.hostname),
                                );
                            if (verify?.action)
                                response.headers.set(
                                    'X-Turnstile-Action',
                                    String(verify.action),
                                );
                            const exp =
                                Date.now() + TURNSTILE_REUSE_TTL_SECONDS * 1000;
                            turnstileReuseCache.set(token, { exp, verify });
                            response.headers.set(
                                'X-Turnstile-Reuse-Until',
                                new Date(exp).toISOString(),
                            );
                            response.headers.set(
                                'X-Turnstile-Reusable',
                                'enabled',
                            );
                        } else {
                            response.headers.set(
                                'X-Turnstile-Validation',
                                'failed',
                            );
                            if (verify?.['error-codes']) {
                                response.headers.set(
                                    'X-Turnstile-Error-Codes',
                                    String(verify['error-codes']),
                                );
                            }
                        }
                    }
                } catch (_e) {
                    void 0;
                }
            },
        ]),
    );

    // Auth endpoint to exchange Turnstile token -> session cookie
    App.binding(
        '/auth/turnstile',
        new handler('POST', [
            async (request, response) => {
                const secret = process.env.TURNSTILE_SECRET;
                if (!secret) {
                    response.status = 500;
                    response.body = JSON.stringify({
                        success: false,
                        error: 'server_misconfigured',
                    });
                    return response;
                }

                // Accept cf-turnstile-response or token via query/body (best-effort)
                let token =
                    request.query.get('cf-turnstile-response') ||
                    request.query.get('token');
                if (!token) {
                    try {
                        const body = String(request.body || '');
                        if (body) {
                            // naive parse for both JSON and form-encoded
                            if (
                                request.headers
                                    .get('Content-Type')
                                    ?.includes('application/json')
                            ) {
                                const parsed = JSON.parse(body);
                                token =
                                    parsed['cf-turnstile-response'] ||
                                    parsed['token'] ||
                                    '';
                            } else if (
                                request.headers
                                    .get('Content-Type')
                                    ?.includes(
                                        'application/x-www-form-urlencoded',
                                    )
                            ) {
                                const usp = new URLSearchParams(body);
                                token =
                                    usp.get('cf-turnstile-response') ||
                                    usp.get('token') ||
                                    '';
                            }
                        }
                    } catch {
                        // ignore
                    }
                }

                if (!token) {
                    response.status = 400;
                    response.body = JSON.stringify({
                        success: false,
                        error: 'missing_token',
                    });
                    return response;
                }

                const form = new URLSearchParams();
                form.set('secret', secret);
                form.set('response', token);
                if (request.ip) form.set('remoteip', request.ip);

                const verify = await axios
                    .post(
                        'https://challenges.cloudflare.com/turnstile/v0/siteverify',
                        form,
                        {
                            headers: {
                                'Content-Type':
                                    'application/x-www-form-urlencoded',
                                'User-Agent': 'fxrate/turnstile-verify',
                            },
                            timeout: 5000,
                        },
                    )
                    .then((r) => r.data)
                    .catch((e) => ({
                        success: false,
                        error: e?.message ?? 'request_error',
                    }));

                if (verify?.success === true) {
                    const { id, exp } = createSession({ turnstile: verify });
                    const attrs = [
                        `${SESSION_COOKIE_NAME}=${encodeURIComponent(id)}`,
                        `Max-Age=${SESSION_TTL_SECONDS}`,
                        'HttpOnly',
                        'Secure',
                        `SameSite=${SESSION_COOKIE_SAMESITE}`,
                        'Path=/',
                    ];
                    if (SESSION_COOKIE_DOMAIN)
                        attrs.push(`Domain=${SESSION_COOKIE_DOMAIN}`);
                    response.headers.set('Set-Cookie', attrs.join('; '));
                    response.status = 200;
                    response.body = JSON.stringify({
                        success: true,
                        expiresAt: new Date(exp).toISOString(),
                    });
                } else {
                    response.status = 403;
                    response.body = JSON.stringify({
                        success: false,
                        error: 'turnstile_verification_failed',
                        details: verify,
                    });
                }
                return response;
            },
        ]),
    );

    // Optional: logout endpoint to clear cookie
    App.binding(
        '/auth/logout',
        new handler('POST', [
            async (_request, response) => {
                const attrs = [
                    `${SESSION_COOKIE_NAME}=`,
                    'Max-Age=0',
                    'HttpOnly',
                    'Secure',
                    `SameSite=${SESSION_COOKIE_SAMESITE}`,
                    'Path=/',
                ];
                if (SESSION_COOKIE_DOMAIN)
                    attrs.push(`Domain=${SESSION_COOKIE_DOMAIN}`);
                response.headers.set('Set-Cookie', attrs.join('; '));
                response.status = 200;
                response.body = JSON.stringify({ success: true });
                return response;
            },
        ]),
    );

    App.use([Manager], '/(.*)');
    App.use([Manager], '/v1/(.*)');

    return App;
};

if (
    process.env.VERCEL == '1' ||
    ((_) => globalThis.esBuilt ?? esMain(_))(import.meta)
) {
    (async () => {
        globalThis.App = await makeInstance(new rootRouter(), Manager);

        if (process.env.VERCEL != '1')
            globalThis.App.listen(Number(process?.env?.PORT) || 8080);

        console.log(
            `[${new Date().toUTCString()}] Server is started at ${Number(process?.env?.PORT) || 8080} with NODE_ENV ${process.env.NODE_ENV || 'development'}.`,
        );
    })();
}

export default async (req: http.IncomingMessage, res: http.ServerResponse) => {
    const request = await globalThis.App.adapater.handleRequest(req);
    const response = await globalThis.App.adapater.router.respond(request);
    globalThis.App.adapater.handleResponse(response, res);
};

export { Manager };
