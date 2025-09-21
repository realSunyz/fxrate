import axios from 'axios';
import { handler } from 'handlers.js';
import process from 'node:process';

import {
    CAPTCHA_ENABLED,
    CAPTCHA_PROVIDER,
    RECAPTCHA_ENABLED,
    TURNSTILE_ENABLED,
    SESSION_TTL_SECONDS,
    SESSION_COOKIE_NAME,
    SESSION_COOKIE_SAMESITE,
    SESSION_COOKIE_SECURE,
    SESSION_COOKIE_DOMAIN,
    createSession,
} from './session';

const TOKEN_KEYS = ['turnstile-token', 'recaptcha-token'];

const extractTokenFromObject = (source: Record<string, unknown>): string => {
    for (const key of TOKEN_KEYS) {
        const value = source[key];
        if (typeof value === 'string' && value) return value;
    }
    return '';
};

const extractToken = (request: any): string => {
    const q = request.query;
    if (q) {
        for (const key of TOKEN_KEYS) {
            const val = q.get?.(key);
            if (val) return val;
        }
    }

    if (request.body && typeof request.body === 'object') {
        const direct = extractTokenFromObject(
            request.body as Record<string, unknown>,
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
                );
        } else if (contentType.includes('application/x-www-form-urlencoded')) {
            const usp = new URLSearchParams(body);
            for (const key of TOKEN_KEYS) {
                const val = usp.get(key);
                if (val) return val;
            }
        }
    } catch (_e) {
        void 0;
    }

    return '';
};

type VerifyOk = { success: true; payload: any };
type VerifyErr = {
    success: false;
    status: number;
    response: { success: false; error: string; details?: any };
};
type VerifyResult = VerifyOk | VerifyErr;

const isVerifyErr = (value: VerifyResult): value is VerifyErr =>
    value.success !== true;

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

const verifyCaptcha = (token: string, request: any): Promise<VerifyResult> => {
    if (TURNSTILE_ENABLED) return verifyTurnstile(token, request);
    if (RECAPTCHA_ENABLED) return verifyRecaptcha(token, request);
    return Promise.resolve({
        success: false,
        status: 500,
        response: {
            success: false,
            error: 'server_misconfigured',
            details: `unsupported_captcha_provider:${CAPTCHA_PROVIDER}`,
        },
    });
};

const createSignedHandler = () =>
    new handler('POST', [
        async (request, response) => {
            if (!CAPTCHA_ENABLED) {
                response.status = 200;
                response.body = JSON.stringify({ success: true });
                return response;
            }

            const token = extractToken(request);
            if (!token) {
                response.status = 403;
                response.body = JSON.stringify({
                    success: false,
                    error: 'token invalid',
                });
                return response;
            }

            const result = await verifyCaptcha(token, request);
            if (isVerifyErr(result)) {
                response.status = result.status;
                response.body = JSON.stringify(result.response);
                return response;
            }

            const { id, exp } = createSession({
                provider: CAPTCHA_PROVIDER,
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

export default createSignedHandler;
