import process from 'node:process';
import http from 'node:http';
import axios from 'axios';

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

                response.headers.set('X-Powered-By', `fxrate/latest`);
                response.headers.set(
                    'X-License',
                    'MIT, Data copyright belongs to its source. More details at <https://github.com/realSunyz/fxrate>.',
                );
                response.headers.set('X-Frame-Options', 'deny');
                response.headers.set('Access-Control-Allow-Origin', '*');
                response.headers.set(
                    'Access-Control-Allow-Methods',
                    'GET, POST, OPTIONS',
                );
                response.headers.set(
                    'Referrer-Policy',
                    'no-referrer-when-downgrade',
                );
                response.headers.set(
                    'Permissions-Policy',
                    'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
                );
                response.headers.set(
                    'Content-Security-Policy',
                    "default-src 'self'",
                );

                try {
                    const secret = process.env.TURNSTILE_SECRET;
                    const token = request.query.get('token');

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
