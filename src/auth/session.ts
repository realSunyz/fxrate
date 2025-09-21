import crypto from 'node:crypto';
import process from 'node:process';

type SessionData = { exp: number; data?: any };

export const SESSION_TTL_SECONDS = Number(
    process.env.SESSION_TTL_SECONDS ?? 300,
);
export const SESSION_COOKIE_DOMAIN =
    process.env.SESSION_COOKIE_DOMAIN || undefined;
export const SESSION_COOKIE_SAMESITE = (process.env.SESSION_COOKIE_SAMESITE ??
    'None') as 'None' | 'Lax' | 'Strict';
export const SESSION_COOKIE_SECURE: boolean = (() => {
    const v = process.env.SESSION_COOKIE_SECURE;
    if (v == null) return process.env.NODE_ENV === 'production';
    return !/^(0|false|no|off)$/i.test(String(v));
})();
const DEFAULT_SESSION_COOKIE_NAME = SESSION_COOKIE_SECURE
    ? SESSION_COOKIE_DOMAIN
        ? '__Secure-fxrate-sess'
        : '__Host-fxrate-sess'
    : 'fxrate_sess';
export const SESSION_COOKIE_NAME = String(
    process.env.SESSION_COOKIE_NAME ?? DEFAULT_SESSION_COOKIE_NAME,
);

const sessionStore = new Map<string, SessionData>();

type CaptchaProvider = 'turnstile' | 'recaptcha' | 'none';

const resolveCaptchaProvider = (): CaptchaProvider => {
    const envValue = process.env.CAPTCHA_PROVIDER;
    const raw = envValue ? envValue.trim().toLowerCase() : undefined;
    switch (raw) {
        case 'turnstile':
            return 'turnstile';
        case 'recaptcha':
            return 'recaptcha';
        case 'none':
        case undefined:
        case '':
            return 'none';
        default:
            return 'none';
    }
};

export const CAPTCHA_PROVIDER: CaptchaProvider = resolveCaptchaProvider();
export const CAPTCHA_ENABLED = CAPTCHA_PROVIDER !== 'none';
export const TURNSTILE_ENABLED = CAPTCHA_PROVIDER === 'turnstile';
export const RECAPTCHA_ENABLED = CAPTCHA_PROVIDER === 'recaptcha';

export const getSessionWithReason = (
    id?: string | null,
): {
    session: SessionData | null;
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

export const parseCookies = (
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

export const createSession = (data?: any) => {
    const id = crypto.randomBytes(32).toString('base64url');
    const exp = Date.now() + SESSION_TTL_SECONDS * 1000;
    sessionStore.set(id, { exp, data });
    return { id, exp };
};

export type { CaptchaProvider };
