import axios from 'axios';
import { handler } from 'handlers.js';
import process from 'node:process';

import type { CaptchaProvider } from './session';
import {
    RECAPTCHA_ENABLED,
    SESSION_COOKIE_DOMAIN,
    SESSION_COOKIE_NAME,
    SESSION_COOKIE_SAMESITE,
    SESSION_COOKIE_SECURE,
    SESSION_TTL_SECONDS,
    TURNSTILE_ENABLED,
    createSession,
} from './session';

type ActiveCaptchaProvider = Exclude<CaptchaProvider, 'none'>;

type VerifyOk = { success: true; payload: any };
type VerifyErr = {
    success: false;
    status: number;
    response: { success: false; error: string; details?: any };
};
type VerifyResult = VerifyOk | VerifyErr;

type CaptchaHandlerOptions = {
    provider: ActiveCaptchaProvider;
    enabled: boolean;
    tokenKeys: string[];
    verify: (token: string, request: any) => Promise<VerifyResult>;
};

const isVerifyErr = (value: VerifyResult): value is VerifyErr =>
    value.success !== true;

const appendTokenFallback = (keys: string[]): string[] => {
    const merged = [...keys, 'token'];
    return Array.from(new Set(merged.filter(Boolean)));
};

const extractTokenFromObject = (
    source: Record<string, unknown>,
    keys: string[],
): string => {
    for (const key of keys) {
        const value = source[key];
        if (typeof value === 'string' && value) return value;
    }
    return '';
};

const extractToken = (request: any, keys: string[]): string => {
    const tokenKeys = appendTokenFallback(keys);
    const q = request.query;
    if (q) {
        for (const key of tokenKeys) {
            const val = q.get?.(key);
            if (val) return val;
        }
    }

    if (request.body && typeof request.body === 'object') {
        const direct = extractTokenFromObject(
            request.body as Record<string, unknown>,
            tokenKeys,
        );
        if (direct) return direct;
    }

    let body = '';
    try {
        body = String(request.body || '');
    } catch (_e) {
        body = '';
    }

    if (!body) return '';

    try {
        const contentType =
            request.headers?.get?.('Content-Type')?.toLowerCase() || '';
        if (contentType.includes('application/json')) {
            const parsed = JSON.parse(body || '{}');
            if (parsed && typeof parsed === 'object')
                return extractTokenFromObject(
                    parsed as Record<string, unknown>,
                    tokenKeys,
                );
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
            const usp = new URLSearchParams(body);
            for (const key of tokenKeys) {
                const val = usp.get(key);
                if (val) return val;
            }
        }
    } catch (_e) {
        void 0;
    }

    return '';
};

const verifyTurnstile = async (
    token: string,
    request: any,
): Promise<VerifyResult> => {
    const secret = process.env.TURNSTILE_SECRET;
    if (!secret) {
        return {
            success: false,
            status: 500,
            response: {
                success: false,
                error: 'server_misconfigured',
                details: 'missing_turnstile_secret',
            },
        };
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
                    'Content-Type': 'application/x-www-form-urlencoded',
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
        return { success: true, payload: verify };
    }

    const errCodes = (verify && verify['error-codes']) || [];
    const isExpired = Array.isArray(errCodes)
        ? errCodes.includes('timeout-or-duplicate')
        : String(errCodes).includes('timeout-or-duplicate');

    return {
        success: false,
        status: 403,
        response: {
            success: false,
            error: isExpired ? 'token expired' : 'token invalid',
        },
    };
};

const verifyRecaptcha = async (
    token: string,
    request: any,
): Promise<VerifyResult> => {
    const secret = process.env.RECAPTCHA_SECRET;
    if (!secret) {
        return {
            success: false,
            status: 500,
            response: {
                success: false,
                error: 'server_misconfigured',
                details: 'missing_recaptcha_secret',
            },
        };
    }

    const form = new URLSearchParams();
    form.set('secret', secret);
    form.set('response', token);
    if (request.ip) form.set('remoteip', request.ip);

    const verify = await axios
        .post('https://www.google.com/recaptcha/api/siteverify', form, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'fxrate/recaptcha-verify',
            },
            timeout: 5000,
        })
        .then((r) => r.data)
        .catch((e) => ({
            success: false,
            error: e?.message ?? 'request_error',
        }));

    if (verify?.success === true) {
        return { success: true, payload: verify };
    }

    const errCodes = (verify && verify['error-codes']) || [];
    const isExpired = Array.isArray(errCodes)
        ? errCodes.includes('timeout-or-duplicate')
        : String(errCodes).includes('timeout-or-duplicate');

    return {
        success: false,
        status: 403,
        response: {
            success: false,
            error: isExpired ? 'token expired' : 'token invalid',
        },
    };
};

const createCaptchaHandler = ({
    provider,
    enabled,
    tokenKeys,
    verify,
}: CaptchaHandlerOptions) =>
    new handler('POST', [
        async (request, response) => {
            response.headers.set('X-Captcha-Provider', provider);

            if (!enabled) {
                response.status = 503;
                response.body = JSON.stringify({
                    success: false,
                    error: 'captcha_disabled',
                    provider,
                });
                return response;
            }

            const token = extractToken(request, tokenKeys);
            if (!token) {
                response.status = 403;
                response.body = JSON.stringify({
                    success: false,
                    error: 'token invalid',
                });
                return response;
            }

            const result = await verify(token, request);
            if (isVerifyErr(result)) {
                response.status = result.status;
                response.body = JSON.stringify(result.response);
                return response;
            }

            const { id, exp } = createSession({
                provider,
                verify: result.payload,
            });
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
        },
    ]);

const TURNSTILE_TOKEN_KEYS = ['turnstile-token'];
const RECAPTCHA_TOKEN_KEYS = ['recaptcha-token', 'g-recaptcha-response'];

export const createTurnstileHandler = () =>
    createCaptchaHandler({
        provider: 'turnstile',
        enabled: TURNSTILE_ENABLED,
        tokenKeys: TURNSTILE_TOKEN_KEYS,
        verify: verifyTurnstile,
    });

export const createRecaptchaHandler = () =>
    createCaptchaHandler({
        provider: 'recaptcha',
        enabled: RECAPTCHA_ENABLED,
        tokenKeys: RECAPTCHA_TOKEN_KEYS,
        verify: verifyRecaptcha,
    });

export { createCaptchaHandler };
