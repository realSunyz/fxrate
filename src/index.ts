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

const SESSION_TTL_SECONDS = Number(process.env.SESSION_TTL_SECONDS ?? 300);
const SESSION_COOKIE_NAME = String(
    process.env.SESSION_COOKIE_NAME ?? 'fxrate_sess',
);
const SESSION_COOKIE_DOMAIN = process.env.SESSION_COOKIE_DOMAIN;
const SESSION_COOKIE_SAMESITE = (process.env.SESSION_COOKIE_SAMESITE ??
    'None') as 'None' | 'Lax' | 'Strict';
const SESSION_COOKIE_SECURE: boolean = (() => {
    const v = process.env.SESSION_COOKIE_SECURE;
    if (v == null) return process.env.NODE_ENV === 'production';
    return !/^(0|false|no|off)$/i.test(String(v));
})();
const sessionStore = new Map<string, { exp: number; data?: any }>();

const getSessionWithReason = (
    id?: string | null,
): {
    session: { exp: number; data?: any } | null;
    reason?: 'expired' | 'missing';
} => {
    if (!id) return { session: null, reason: 'missing' };
    const s = sessionStore.get(id);
    if (!s) return { session: null, reason: 'missing' };
    if (s.exp <= Date.now()) {
        sessionStore.delete(id);
        return { session: null, reason: 'expired' };
    }
    return { session: s };
};

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

                const origin = request.headers.get('Origin');
                const allowOrigin = process.env.CORS_ORIGIN || '*';
                if (allowOrigin === '*' && origin) {
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

                if (request.method === 'OPTIONS') {
                    response.status = 204;
                    response.body = '';
                    throw response;
                }

                try {
                    (request as any).custom = (request as any).custom || {};

                    const qToken = request.query.get('token');
                    if (qToken === '__internal__') {
                        (request as any).custom.turnstile = { success: true };
                        response.headers.set('X-Auth', 'internal');
                        return;
                    }

                    const cookies = parseCookies(
                        request.headers.get('Cookie') ||
                            request.headers.get('cookie'),
                    );
                    const { session, reason } = getSessionWithReason(
                        cookies[SESSION_COOKIE_NAME],
                    );
                    if (session) {
                        (request as any).custom.turnstile = { success: true };
                        response.headers.set('X-Session', 'valid');
                    } else {
                        (request as any).custom.turnstile = {
                            success: false,
                            error:
                                reason === 'expired'
                                    ? 'token expired'
                                    : 'token invalid',
                        };
                        response.headers.set(
                            'X-Session',
                            reason === 'expired' ? 'expired' : 'missing',
                        );
                    }
                } catch (_e) {
                    void 0;
                }
            },
        ]),
    );

    App.binding(
        '/auth/signed',
        new handler('POST', [
            async (request, response) => {
                const q = request.query;
                let token =
                    q.get('cf-turnstile-response') ||
                    q.get('cf_token') ||
                    q.get('token') ||
                    '';

                if (!token) {
                    try {
                        const body = String(request.body || '');
                        if (body) {
                            if (
                                request.headers
                                    .get('Content-Type')
                                    ?.includes('application/json')
                            ) {
                                const parsed = JSON.parse(body || '{}');
                                token =
                                    parsed['cf-turnstile-response'] ||
                                    parsed['cf_token'] ||
                                    parsed['token'] ||
                                    token;
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
                                    usp.get('cf_token') ||
                                    usp.get('token') ||
                                    token;
                            }
                        }
                    } catch (_e) {
                        // ignore body parse errors
                    }
                }

                const secret = process.env.TURNSTILE_SECRET;
                if (!token) {
                    response.status = 403;
                    response.body = JSON.stringify({
                        success: false,
                        error: 'token invalid',
                    });
                    return response;
                }
                if (!secret) {
                    response.status = 500;
                    response.body = JSON.stringify({
                        success: false,
                        error: 'server_misconfigured',
                        details: 'missing_turnstile_secret',
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
                        `SameSite=${SESSION_COOKIE_SAMESITE}`,
                        'Path=/',
                    ];
                    if (SESSION_COOKIE_SECURE) attrs.push('Secure');
                    if (SESSION_COOKIE_DOMAIN)
                        attrs.push(`Domain=${SESSION_COOKIE_DOMAIN}`);
                    response.headers.set('Set-Cookie', attrs.join('; '));
                    response.status = 200;
                    response.body = JSON.stringify({
                        success: true,
                        expiresAt: new Date(exp).toISOString(),
                    });
                    return response;
                }

                const errCodes = (verify && verify['error-codes']) || [];
                const isExpired = Array.isArray(errCodes)
                    ? errCodes.includes('timeout-or-duplicate')
                    : String(errCodes).includes('timeout-or-duplicate');
                response.status = 403;
                response.body = JSON.stringify({
                    success: false,
                    error: isExpired ? 'token expired' : 'token invalid',
                });
                return response;
            },
        ]),
    );

    App.binding(
        '/auth/logout',
        new handler('POST', [
            async (_request, response) => {
                const attrs = [
                    `${SESSION_COOKIE_NAME}=`,
                    'Max-Age=0',
                    'HttpOnly',
                    `SameSite=${SESSION_COOKIE_SAMESITE}`,
                    'Path=/',
                ];
                if (SESSION_COOKIE_SECURE) attrs.push('Secure');
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
