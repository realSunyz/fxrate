import fxManager from '../fxm/fxManager';
import axios from 'axios';

import { fraction } from 'mathjs';

import { LRUCache } from 'lru-cache';
import { currency } from 'src/types';

import dayjs from 'dayjs';

import utc from 'dayjs/plugin/utc';

dayjs.extend(utc);

const cache = new LRUCache<string, string>({
    max: 500,
    ttl: 1000 * 60 * 30,
    ttlAutopurge: true,
});

const headers = {
    accept: 'application/json, text/plain, */*',
    'accept-language': 'en,zh-CN;q=0.9,zh;q=0.8',
    'sec-ch-ua':
        '"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Linux"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    Referer:
        'https://usa.visa.com/support/consumer/travel-support/exchange-rate-calculator.html',
    'Referrer-Policy': 'no-referrer-when-downgrade',
};

const currenciesList: string[] = [
    'AED',
    'AFN',
    'ALL',
    'AMD',
    'ANG',
    'AOA',
    'ARS',
    'AUD',
    'AWG',
    'AZN',
    'BAM',
    'BBD',
    'BDT',
    'BGN',
    'BHD',
    'BIF',
    'BMD',
    'BND',
    'BOB',
    'BRL',
    'BSD',
    'BTN',
    'BWP',
    'BYN',
    'BZD',
    'CAD',
    'CDF',
    'CHF',
    'CLP',
    'CNY',
    'CNH',
    'COP',
    'CRC',
    'CVE',
    'CYP',
    'CZK',
    'DJF',
    'DKK',
    'DOP',
    'DZD',
    'EEK',
    'EGP',
    'ERN',
    'ETB',
    'EUR',
    'FJD',
    'FKP',
    'GBP',
    'GEL',
    'GHS',
    'GIP',
    'GMD',
    'GNF',
    'GQE',
    'GTQ',
    'GWP',
    'GYD',
    'HKD',
    'HNL',
    'HRK',
    'HTG',
    'HUF',
    'IDR',
    'ILS',
    'INR',
    'IQD',
    'IRR',
    'ISK',
    'JMD',
    'JOD',
    'JPY',
    'KES',
    'KGS',
    'KHR',
    'KMF',
    'KRW',
    'KWD',
    'KYD',
    'KZT',
    'LAK',
    'LBP',
    'LKR',
    'LRD',
    'LSL',
    'LTL',
    'LVL',
    'LYD',
    'MAD',
    'MDL',
    'MGA',
    'MKD',
    'MMK',
    'MNT',
    'MOP',
    'MRO',
    'MRU',
    'MTL',
    'MUR',
    'MVR',
    'MWK',
    'MXN',
    'MYR',
    'MZN',
    'NAD',
    'NGN',
    'NIO',
    'NOK',
    'NPR',
    'NZD',
    'None',
    'OMR',
    'PAB',
    'PEN',
    'PGK',
    'PHP',
    'PKR',
    'PLN',
    'PYG',
    'QAR',
    'RON',
    'RSD',
    'RUB',
    'RWF',
    'SAR',
    'SBD',
    'SCR',
    'SDG',
    'SEK',
    'SGD',
    'SHP',
    'SIT',
    'SKK',
    'SLL',
    'SOS',
    'SRD',
    'SSP',
    'STD',
    'STN',
    'SVC',
    'SYP',
    'SZL',
    'THB',
    'TJS',
    'TMT',
    'TND',
    'TOP',
    'TRY',
    'TTD',
    'TWD',
    'TZS',
    'UAH',
    'UGX',
    'USD',
    'UYU',
    'UZS',
    'VEF',
    'VES',
    'VND',
    'VUV',
    'WST',
    'XAF',
    'XCD',
    'XOF',
    'XPF',
    'YER',
    'ZAR',
    'ZMW',
    'ZWL',
];

export default class visaFXM extends fxManager {
    ableToGetAllFXRate: boolean = false;

    public get fxRateList() {
        const fxRateList: fxManager['_fxRateList'] = {} as any;

        currenciesList.forEach((from) => {
            fxRateList[from] = {} as any;
            currenciesList.forEach((to) => {
                const _from = from == 'CNH' ? 'CNY' : from;
                const _to = to == 'CNH' ? 'CNY' : to;

                const currency = new Proxy(
                    {},
                    {
                        get: (_obj, prop) => {
                            if (
                                ![
                                    'cash',
                                    'remit',
                                    'middle',
                                    'updated',
                                    'provided',
                                ].includes(prop.toString())
                            ) {
                                return undefined;
                            }

                            // Do not perform network in getter; rely on cache only.
                            // Network fetch is handled in getfxRateList/getUpdatedDate.

                            if (
                                ['cash', 'remit', 'middle'].includes(
                                    prop.toString(),
                                )
                            ) {
                                const cached = cache.get(`${_from}${_to}`);
                                if (!cached) return undefined;
                                const data = JSON.parse(cached);
                                return fraction(data.originalValues.fxRateVisa);
                            } else if (prop.toString() === 'updated') {
                                const cached = cache.get(`${_from}${_to}`);
                                if (!cached)
                                    return new Date(`1970-01-01T00:00:00Z`);
                                const data = JSON.parse(cached);
                                return new Date(
                                    data.originalValues.lastUpdatedVisaRate *
                                        1000,
                                );
                            } else if (prop.toString() === 'provided') {
                                return true;
                            }
                        },
                    },
                );
                fxRateList[from][to] = currency;
            });
        });

        return fxRateList;
    }

    public async getfxRateList(from: currency, to: currency) {
        const _from = from == 'CNH' ? 'CNY' : from;
        const _to = to == 'CNH' ? 'CNY' : to;

        if (
            !(
                currenciesList.includes(from as string) &&
                currenciesList.includes(to as string)
            )
        ) {
            throw new Error('Currency not supported');
        }

        if (cache.has(`${_from}${_to}`)) {
            return this.fxRateList[from][to];
        }

        const dateString = dayjs().utc().format('MM/DD/YYYY');

        const req = await axios.get(
            `https://www.visa.com.hk/cmsapi/fx/rates?amount=1&fee=0&utcConvertedDate=${dateString}&exchangedate=${dateString}&fromCurr=${_to}&toCurr=${_from}`,
            {
                headers,
            },
        );

        const data = req.data;
        cache.set(`${_from}${_to}`, JSON.stringify(data));

        return this.fxRateList[from][to];
    }

    constructor() {
        super([]);
    }

    public update(): void {
        throw new Error('Method is deprecated');
    }

    public async getUpdatedDate(from: currency, to: currency): Promise<Date> {
        const _from = from == 'CNH' ? 'CNY' : from;
        const _to = to == 'CNH' ? 'CNY' : to;
        if (!cache.has(`${_from}${_to}`)) {
            await this.getfxRateList(from, to);
        }
        const cached = cache.get(`${_from}${_to}`);
        if (!cached)
            throw new Error(
                'FX Path from ' + from + ' to ' + to + ' not found',
            );
        const data = JSON.parse(cached);
        return new Date(data.originalValues.lastUpdatedVisaRate * 1000);
    }
}
