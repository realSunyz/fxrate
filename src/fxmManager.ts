import { router, response, request, handler, interfaces } from 'handlers.js';
import fxManager from './fxm/fxManager';
import { FXRate, JSONRPCMethods, currency } from 'src/types';
import { supportedCurrenciesList } from './constant';

import { round, multiply, Fraction } from 'mathjs';

import process from 'node:process';

import JSONRPCRouter from 'handlers.js-jsonrpc';

export const useBasic = (response: response<any>): void => {
    response.status = 200;
    response.headers.set('Date', new Date().toUTCString());

    // if (process.env.ENABLE_CORS) {
    //     response.headers.set(
    //         'Access-Control-Allow-Origin',
    //         process.env.CORS_ORIGIN || '*',
    //     );
    //     response.headers.set(
    //         'Access-Control-Allow-Methods',
    //         'GET, POST, OPTIONS',
    //     );
    //     response.headers.set('Allow', 'GET, POST, OPTIONS');
    //     response.headers.set(
    //         'Access-Control-Expose-Headers',
    //         'Date, X-License, X-Author, X-Powered-By',
    //     );
    // }
};

export const useInternalRestAPI = async (url: string, router: router) => {
    const u = new URL(`http://this.internal/${url}`);
    if (!u.searchParams.has('token'))
        u.searchParams.set('token', '__internal__');

    const req = new request(
        'GET',
        u,
        new interfaces.headers({}),
        '',
        {},
    ).extends({ turnstile: { success: true } });

    const restResponse = await router.respond(req).catch((e) => e);

    try {
        return JSON.parse(restResponse.body);
    } catch (_e) {
        if (!(restResponse instanceof response)) throw new Error(restResponse);
        return restResponse;
    }
};

const sortObject = (obj: unknown): any => {
    if (obj instanceof Array) {
        return obj.sort();
    }
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }

    const fxOrder = ['cash', 'remit', 'middle', 'provided', 'updated'];
    const keys = Object.keys(obj as any);

    if (keys.some((k) => fxOrder.includes(k))) {
        const ordered: any = {};
        for (const k of fxOrder) {
            if (k in (obj as any)) ordered[k] = sortObject((obj as any)[k]);
        }
        const rest = keys.filter((k) => !fxOrder.includes(k)).sort();
        for (const k of rest) ordered[k] = sortObject((obj as any)[k]);
        return ordered;
    }

    const sortedObj: any = {};
    for (const key of keys.sort()) {
        sortedObj[key] = sortObject((obj as any)[key]);
    }
    return sortedObj;
};

const useJson = (response: response<any>, request: request<any>): void => {
    useBasic(response);

    const answer = JSON.parse(response.body);
    const sortedAnswer = sortObject(answer);

    response.body = JSON.stringify(sortedAnswer);

    if (
        request.query.has('pretty') ||
        request.headers.get('Sec-Fetch-Dest') === 'document'
    ) {
        response.body = JSON.stringify(sortedAnswer, null, 4);
    }

    response.headers.set('Content-type', 'application/json; charset=utf-8');
};

const getConvert = async (
    from: currency,
    to: currency,
    type: string,
    fxManager: fxManager,
    request: request<any>,
    amount: number = 100,
    fees: number = 0,
) => {
    const provided = Boolean(
        (await fxManager.fxRateList[from]) &&
            (await fxManager.fxRateList[from][to]) &&
            (await fxManager.fxRateList[from][to]).provided === true,
    );

    if (!provided) {
        return 0;
    }

    let answer = await fxManager.convert(
        from,
        to,
        type as 'cash' | 'remit' | 'middle',
        Number(request.query.get('amount')) || amount || 100,
        request.query.has('reverse'),
    );
    answer = multiply(
        answer,
        1 + (Number(request.query.get('fees')) || fees) / 100,
    ) as Fraction;
    answer =
        Number(request.query.get('precision')) !== -1
            ? round(answer, Number(request.query.get('precision')) || 5)
            : answer;
    return Number(answer.toString()) || answer.toString();
};

const getDetails = async (
    from: currency,
    to: currency,
    fxManager: fxManager,
    request: request<any>,
) => {
    const provided = Boolean(
        (await fxManager.fxRateList[from]) &&
            (await fxManager.fxRateList[from][to]) &&
            (await fxManager.fxRateList[from][to]).provided === true,
    );

    const result: any = {};

    if (!provided) {
        result.cash = 0;
        result.remit = 0;
        result.middle = 0;
        result.provided = false;
        result.updated = 'Thu, Jan 01 1970 00:00:00 GMT';
        return result;
    }

    for (const type of ['cash', 'remit', 'middle']) {
        try {
            result[type] = await getConvert(from, to, type, fxManager, request);
        } catch (_e) {
            result[type] = false;
        }
    }

    result.provided = true;

    try {
        result.updated = (
            await fxManager.getUpdatedDate(from, to)
        ).toUTCString();
    } catch (_e) {
        result.updated = false;
    }
    return result;
};

class fxmManager extends JSONRPCRouter<any, any, JSONRPCMethods> {
    private fxms: {
        [source: string]: fxManager;
    } = {};

    private fxmStatus: {
        [source: string]: 'ready' | 'pending';
    } = {};

    private fxRateGetter: {
        [source: string]: (fxmManager?: fxmManager) => Promise<FXRate[]>;
    } = {};

    public intervalIDs: {
        key: { timeout: NodeJS.Timeout; refreshDate: Date };
    } = {} as any;

    protected rpcHandlers = {
        instanceInfo: () => useInternalRestAPI('info', this),

        listCurrencies: async ({ source }) => {
            if (!source) throw new Error('source is required.');

            const k = await useInternalRestAPI(`${source}/`, this);
            return new Object({
                currency: k.currency,
                date: k.date,
            });
        },

        listFXRates: ({
            source,
            from,
            precision = 2,
            amount = 100,
            fees = 0,
            reverse = false,
        }) => {
            if (!source) throw new Error('source is required.');
            if (!from) throw new Error('from is required.');

            return useInternalRestAPI(
                `${source}/${from}?precision=${precision}&amount=${amount}&fees=${fees}${reverse ? '&reverse' : ''}`,
                this,
            );
        },

        getFXRate: ({
            source,
            from,
            to,
            type,
            precision = 2,
            amount = 100,
            fees = 0,
            reverse = false,
        }) => {
            if (!source) throw new Error('source is required.');
            if (!from) throw new Error('from is required.');
            if (!to) throw new Error('to is required.');
            if (!type) throw new Error('type is required.');
            if (type == 'all') type = '';

            return useInternalRestAPI(
                `${source}/${from}/${to}/${type}?precision=${precision}&fees=${fees}${reverse ? '&reverse' : ''}&amount=${amount}`,
                this,
            );
        },
    };

    constructor(sources: { [source: string]: () => Promise<FXRate[]> }) {
        super();
        for (const source in sources) {
            this.registerGetter(source, sources[source]);
        }

        this.binding(
            '/info',
            this.create('GET', async (request: request<any>) => {
                const rep = new response<any>('', 200);

                const valid =
                    (request as any)?.custom?.turnstile?.success === true;
                if (!valid) {
                    rep.status = 403;
                    rep.body = JSON.stringify({
                        success: false,
                        error: 'Invalid Token',
                        cash: 0,
                        remit: 0,
                        middle: 0,
                        provided: false,
                        updated: new Date().toUTCString(),
                    });
                    useJson(rep, request);
                    return rep;
                }

                rep.body = JSON.stringify({
                    status: 'ok',
                    sources: Object.keys(this.fxms),
                    version: `fxrate@${globalThis.GITBUILD || 'git'} ${globalThis.BUILDTIME || 'devlopment'}`,
                    apiVersion: 'v1',
                    environment: process.env.NODE_ENV || 'development',
                    success: true,
                    error: '',
                });
                useJson(rep, request);
                return rep;
            }),
        );

        const enforceToken = async (
            request: request<any>,
            response: response<any>,
        ) => {
            const valid = (request as any)?.custom?.turnstile?.success === true;
            if (!valid) {
                response.status = 403;
                response.body = JSON.stringify({
                    success: false,
                    error: 'Invalid Token',
                    cash: 0,
                    remit: 0,
                    middle: 0,
                    provided: false,
                    updated: new Date().toUTCString(),
                });
                useJson(response, request);
                throw response;
            }
            return response;
        };

        this.binding('/jsonrpc', new handler('ANY', [enforceToken]));
        this.binding('/jsonrpc/(.*)', new handler('ANY', [enforceToken]));
        this.binding('/jsonrpc/v2(.*)', new handler('ANY', [enforceToken]));

        this.enableList().mount();
        this.log('JSONRPC is mounted.');
    }

    public log(str: string) {
        if (process.env.LOG_LEVEL === 'error') return;
        setTimeout(() => {
            console.log(`[${new Date().toUTCString()}] [fxmManager] ${str}`);
        }, 0);
    }

    public has(source: string): boolean {
        return this.fxms[source] !== undefined;
    }

    public async updateFXManager(source: string): Promise<void> {
        if (!this.has(source)) {
            throw new Error('Source not found');
        }
        this.log(`${source} is updating...`);
        let fxRates = await this.fxRateGetter[source](this);

        const supported = supportedCurrenciesList[source];
        if (supported && supported.length) {
            fxRates = fxRates.filter(
                (f) =>
                    supported.includes(f.currency.from as unknown as any) ||
                    supported.includes(f.currency.to as unknown as any),
            );
        }

        fxRates.forEach((f) => this.fxms[source].update(f));

        this.fxmStatus[source] = 'ready';
        this.intervalIDs[source].refreshDate = new Date();
        this.log(`${source} is updated, now is ready.`);
        return;
    }

    public async requestFXManager(source: string): Promise<fxManager> {
        if (this.fxmStatus[source] === 'pending') {
            await this.updateFXManager(source);
        }
        return this.fxms[source];
    }

    public registerGetter(
        source: string,
        getter: () => Promise<FXRate[]>,
    ): void {
        this.fxms[source] = new fxManager([]);
        this.fxRateGetter[source] = getter;
        this.fxmStatus[source] = 'pending';
        this.mountFXMRouter(source);
        this.log(`Registered ${source}.`);

        const refreshDate = new Date();

        this.intervalIDs[source] = {
            timeout: setInterval(
                () => this.updateFXManager(source),
                1000 * 60 * 30,
            ),
            refreshDate: refreshDate,
        };
    }

    public registerFXM(source: string, fxManager: fxManager): void {
        this.fxms[source] = fxManager;
        this.fxmStatus[source] = 'ready';
        this.mountFXMRouter(source);
        this.log(`Registered ${source}.`);
    }

    private mountFXMRouter(source: string): void {
        this.use([this.getFXMRouter(source)], `/${source}/(.*)`);
        this.use([this.getFXMRouter(source)], `/${source}`);
    }

    private getFXMRouter(source: string): router {
        const fxmRouter = new router();

        const useCache = (response: response<any>) => {
            response.headers.set(
                'Cache-Control',
                `public, max-age=${
                    30 * 60 -
                    Math.round(
                        Math.abs(
                            ((
                                this.intervalIDs[source] ?? {
                                    refreshDate: new Date(),
                                }
                            ).refreshDate.getTime() -
                                new Date().getTime()) /
                                1000,
                        ) % 1800,
                    )
                }`,
            );
        };

        const isTurnstileValid = (request: request<any>) => {
            const ver = (request as any)?.custom?.turnstile;
            return ver?.success === true;
        };

        const invalidTokenPairResponse = async (
            _from: string,
            _to: string,
            request: request<any>,
            response: response<any>,
        ) => {
            const body = {
                success: false,
                error: 'Invalid Token',
                cash: 0,
                remit: 0,
                middle: 0,
                provided: false,
                updated: new Date().toUTCString(),
            } as any;
            response.status = 403;
            response.body = JSON.stringify(body);
            useJson(response, request);
            response.headers.set('Date', new Date().toUTCString());
            return response;
        };

        const handlerSourceInfo = async (
            request: request<any>,
            response: response<any>,
        ) => {
            if (!isTurnstileValid(request)) {
                response.status = 403;
                response.body = JSON.stringify({
                    success: false,
                    error: 'Invalid Token',
                    cash: 0,
                    remit: 0,
                    middle: 0,
                    provided: false,
                    updated: new Date().toUTCString(),
                });
                useJson(response, request);
                useCache(response);
                throw response;
            }
            if (request.params[0] && request.params[0] != source) {
                return response;
            }
            response.body = JSON.stringify({
                status: 'ok',
                source,
                currency: Object.keys(
                    (await this.requestFXManager(source)).fxRateList,
                ).sort(),
                date: new Date().toUTCString(),
                success: true,
                error: '',
            });
            useJson(response, request);
            useCache(response);
            throw response;
        };

        const handlerCurrencyAllFXRates = async (
            request: request<any>,
            response: response<any>,
        ) => {
            if (!isTurnstileValid(request)) {
                response.status = 403;
                response.body = JSON.stringify({
                    success: false,
                    error: 'Invalid Token',
                    cash: 0,
                    remit: 0,
                    middle: 0,
                    provided: false,
                    updated: new Date().toUTCString(),
                });
                useJson(response, request);
                useCache(response);
                return response;
            }
            if (request.params.from)
                request.params.from = request.params.from.toUpperCase();

            const { from } = request.params;

            const result: {
                [to in keyof currency]: {
                    [type in string]: string;
                };
            } = {} as any;
            if (!(await this.requestFXManager(source)).ableToGetAllFXRate) {
                response.status = 403;
                result['status'] = 'error';
                result['message'] =
                    `Not able to get all FX rate with ${from} on ${source}`;
                response.body = JSON.stringify(result);
                useJson(response, request);
                return response;
            }
            for (const to in (await this.requestFXManager(source)).fxRateList[
                from
            ]) {
                if (to == from) continue;
                result[to] = await getDetails(
                    from as unknown as currency,
                    to as unknown as currency,
                    await this.requestFXManager(source),
                    request,
                );
            }
            (result as any).success = true;
            (result as any).error = '';
            response.body = JSON.stringify(result);
            useJson(response, request);
            useCache(response);
            return response;
        };

        const handlerCurrencyConvert = async (
            request: request<any>,
            response: response<any>,
        ) => {
            if (request.params.from)
                request.params.from = request.params.from.toUpperCase();

            if (request.params.to)
                request.params.to = request.params.to.toUpperCase();

            const { from, to } = request.params;
            if (!isTurnstileValid(request)) {
                return invalidTokenPairResponse(from, to, request, response);
            }
            const result = await getDetails(
                from as unknown as currency,
                to as unknown as currency,
                await this.requestFXManager(source),
                request,
            );
            (result as any).success = true;
            (result as any).error = '';
            response.body = JSON.stringify(result);
            useJson(response, request);
            try {
                if (result.provided === true) {
                    response.headers.set(
                        'Date',
                        (
                            await (
                                await this.requestFXManager(source)
                            ).getUpdatedDate(
                                from as unknown as currency,
                                to as unknown as currency,
                            )
                        ).toUTCString(),
                    );
                } else {
                    response.headers.set('Date', new Date().toUTCString());
                }
            } catch (_e) {
                response.headers.set('Date', new Date().toUTCString());
            }
            useCache(response);

            return response;
        };

        const handlerCurrencyConvertAmount = async (
            request: request<any>,
            response: response<any>,
        ) => {
            if (request.params.from)
                request.params.from = request.params.from.toUpperCase();

            if (request.params.to)
                request.params.to = request.params.to.toUpperCase();

            const { from, to, amount } = request.params;
            if (!isTurnstileValid(request)) {
                return invalidTokenPairResponse(from, to, request, response);
            }
            const details: any = {};
            try {
                details.cash = await getConvert(
                    from as unknown as currency,
                    to as unknown as currency,
                    'cash',
                    await this.requestFXManager(source),
                    request,
                    Number(amount),
                );
            } catch (_e) {
                details.cash = false;
            }

            try {
                details.remit = await getConvert(
                    from as unknown as currency,
                    to as unknown as currency,
                    'remit',
                    await this.requestFXManager(source),
                    request,
                    Number(amount),
                );
            } catch (_e) {
                details.remit = false;
            }

            try {
                details.middle = await getConvert(
                    from as unknown as currency,
                    to as unknown as currency,
                    'middle',
                    await this.requestFXManager(source),
                    request,
                    Number(amount),
                );
            } catch (_e) {
                details.middle = false;
            }

            details.provided = Boolean(
                (await this.requestFXManager(source)).fxRateList[from] &&
                    (await this.requestFXManager(source)).fxRateList[from][
                        to
                    ] &&
                    (await this.requestFXManager(source)).fxRateList[from][to]
                        .provided === true,
            );

            try {
                details.updated = (
                    await (
                        await this.requestFXManager(source)
                    ).getUpdatedDate(
                        from as unknown as currency,
                        to as unknown as currency,
                    )
                ).toUTCString();
            } catch (_e) {
                details.updated = false;
            }

            details.success = true;
            details.error = '';

            response.body = JSON.stringify(details);
            useJson(response, request);
            try {
                const details = await getDetails(
                    from as unknown as currency,
                    to as unknown as currency,
                    await this.requestFXManager(source),
                    request,
                );
                if (details.provided === true) {
                    response.headers.set(
                        'Date',
                        (
                            await (
                                await this.requestFXManager(source)
                            ).getUpdatedDate(
                                from as unknown as currency.unknown,
                                to as unknown as currency.unknown,
                            )
                        ).toUTCString(),
                    );
                } else {
                    response.headers.set('Date', new Date().toUTCString());
                }
            } catch (_e) {
                response.headers.set('Date', new Date().toUTCString());
            }
            useCache(response);

            return response;
        };

        fxmRouter.binding('/', new handler('GET', [handlerSourceInfo]));

        fxmRouter.binding(
            '/:from',
            new handler('GET', [handlerSourceInfo, handlerCurrencyAllFXRates]),
        );

        fxmRouter.binding(
            '/:from/:to',
            new handler('GET', [handlerCurrencyConvert]),
        );

        fxmRouter.binding(
            '/:from/:to/:type',
            new handler('GET', [handlerCurrencyConvertAmount]),
        );

        fxmRouter.binding(
            '/:from/:to/:type/:amount',
            new handler('GET', [handlerCurrencyConvertAmount]),
        );

        return fxmRouter;
    }

    public stopAllInterval(): void {
        for (const id in this.intervalIDs) {
            clearInterval(this.intervalIDs[id].timeout);
        }
    }
}

export default fxmManager;
