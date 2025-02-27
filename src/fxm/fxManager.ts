import { create, all, Fraction } from 'mathjs';
import { currency, FXRate, FXPath } from '../types';

const math = create(all, {
    number: 'Fraction',
});

const { multiply, divide, fraction, add } = math;

type FXRateType = {
    cash: Fraction;
    remit: Fraction;
    middle: Fraction;
    updated: Date;
};

export default class fxManager {
    private _fxRateList: {
        [currency in keyof currency]: {
            [currency in keyof currency]: FXRateType;
        };
    } = {} as any;

    public get fxRateList() {
        const fxRateList = new Proxy(this._fxRateList, {
            get: function (target, prop) {
                let child = target[prop];

                if (prop == 'CNY' && !('CNY' in target)) {
                    if ('CNH' in target) {
                        child = target['CNH'];
                    }
                }

                if (!child) {
                    return undefined;
                }

                return new Proxy(child, {
                    get: function (target, prop) {
                        let child = target[prop];

                        if (prop == 'CNY' && !('CNY' in target)) {
                            if ('CNH' in target) {
                                child = target['CNH'];
                            }
                        }

                        return child;
                    },
                });
            },
        });

        return fxRateList;
    }

    public set fxRateList(value) {
        this._fxRateList = value;
    }

    public async getfxRateList(
        from: currency,
        to: currency,
    ): Promise<FXRateType> {
        return this.fxRateList[from][to];
    }

    public async setfxRateList(
        from: currency,
        to: currency,
        value: {
            cash: Fraction;
            remit: Fraction;
            middle: Fraction;
            updated: Date;
        },
    ) {
        this.fxRateList[from][to] = value;
    }

    ableToGetAllFXRate: boolean = true;

    constructor(FXRates: FXRate[]) {
        FXRates.sort().forEach((fxRate) => {
            try {
                this.update(fxRate);
            } catch (e) {
                console.error(e, fxRate);
            }
        });
        return this;
    }

    public update(FXRate: FXRate): void {
        const { currency, unit } = FXRate;
        let { rate } = FXRate;

        let { from, to } = currency;

        if (from == ('RMB' as currency.RMB)) from = 'CNY' as currency.CNY;
        if (to == ('RMB' as currency.RMB)) to = 'CNY' as currency.CNY;

        // if (from == ('CNH' as currency.CNH) || to == ('CNH' as currency.CNH)) {
        //     const CNYFXrates = Object.assign({}, FXRate);
        //     CNYFXrates.currency.from =  CNYFXrates.currency.from == 'CNH' ? 'CNY' as currency.CNY : CNYFXrates.currency.from;
        //     CNYFXrates.currency.to =  CNYFXrates.currency.to == 'CNH' ? 'CNY' as currency.CNY : CNYFXrates.currency.to;
        //     this.update(CNYFXrates);
        // }

        if (this.fxRateList[from] && this.fxRateList[from][to]) {
            if (this.fxRateList[from][to].updated > FXRate.updated) return;
        }

        if (!rate.buy && !rate.sell && !rate.middle) {
            console.log(FXRate);
            throw new Error('Invalid FXRate');
        }

        if (!rate.buy && !rate.sell) {
            rate = {
                buy: {
                    cash: rate.middle,
                    remit: rate.middle,
                },
                sell: {
                    cash: rate.middle,
                    remit: rate.middle,
                },
                middle: rate.middle,
            };
        } else if (!rate.buy && rate.sell) {
            rate.buy = rate.sell;
        } else if (!rate.sell && rate.buy) {
            rate.sell = rate.buy;
        }

        if (!rate.middle) {
            rate.middle = divide(
                add(
                    math.min(
                        rate.buy.cash || Infinity,
                        rate.buy.remit || Infinity,
                        rate.sell.cash || Infinity,
                        rate.sell.remit || Infinity,
                    ),
                    math.max(
                        rate.buy.cash || -Infinity,
                        rate.buy.remit || -Infinity,
                        rate.sell.cash || -Infinity,
                        rate.sell.remit || -Infinity,
                    ),
                ),
                2,
            ) as Fraction;
        }

        if (!this.fxRateList[from]) {
            this.fxRateList[from] = {
                [from]: {
                    cash: fraction(1),
                    remit: fraction(1),
                    middle: fraction(1),
                    updated: new Date(`1970-1-1 00:00:00 UTC`),
                },
            };
        }
        this.fxRateList[from][to] = {
            middle: divide(fraction(rate.middle), unit),
            updated: FXRate.updated,
        };
        if (!this.fxRateList[to]) {
            this.fxRateList[to] = {
                [to]: {
                    cash: fraction(1),
                    remit: fraction(1),
                    middle: fraction(1),
                    updated: new Date(`1970-1-1 00:00:00 UTC`),
                },
            };
        }
        this.fxRateList[to][from] = {
            middle: divide(unit, fraction(rate.middle)),
            updated: FXRate.updated,
        };

        if (rate.buy.cash) {
            this.fxRateList[from][to].cash = divide(
                fraction(rate.buy.cash),
                unit,
            );
        }

        if (rate.sell.cash) {
            this.fxRateList[to][from].cash = divide(
                unit,
                fraction(rate.sell.cash),
            );
        }

        if (rate.buy.remit) {
            this.fxRateList[from][to].remit = divide(
                fraction(rate.buy.remit),
                unit,
            );
        }

        if (rate.sell.remit) {
            this.fxRateList[to][from].remit = divide(
                unit,
                fraction(rate.sell.remit),
            );
        }
    }

    private async convertDirect(
        from: currency,
        to: currency,
        type: 'cash' | 'remit' | 'middle',
        amount: number | Fraction,
        reverse: boolean = false,
    ): Promise<Fraction> {
        if (!(await this.getfxRateList(from, to))[type]) {
            throw new Error(
                `FX Path from ${from} to ${to} not support ${type} now`,
            );
        }
        if (reverse) {
            return divide(
                fraction(amount),
                (await this.fxRateList[from][to])[type],
            ) as unknown as Fraction;
        }
        return multiply(
            (await this.fxRateList[from][to])[type],
            fraction(amount),
        ) as unknown as Fraction;
    }

    async getFXPath(from: currency, to: currency): Promise<FXPath> {
        const FXPath = {
            from,
            end: to,
            path: [],
        } as FXPath;

        if (from === to) {
            FXPath.path.push(from);
            return FXPath;
        }
        if (this.fxRateList[from][to]) {
            FXPath.path.push(to);
            return FXPath;
        }
        if (!this.fxRateList[from] || !this.fxRateList[to]) {
            throw new Error('Invalid currency');
        }
        const queue: { currency: currency; path: currency[] }[] = [];
        const visited: currency[] = [];

        queue.push({ currency: from, path: [from] });

        while (queue.length > 0) {
            const { currency, path } = queue.shift()!;
            visited.push(currency);

            if (currency === to) {
                FXPath.path = path;
                return FXPath;
            }

            const neighbors = Object.keys(
                this.fxRateList[currency],
            ) as currency[];
            for (const neighbor of neighbors) {
                if (!visited.includes(neighbor)) {
                    queue.push({
                        currency: neighbor,
                        path: [...path, neighbor],
                    });
                }
            }
        }

        throw new Error('No FX path found between ' + from + ' and ' + to);
    }

    async convert(
        from: currency,
        to: currency,
        type: 'cash' | 'remit' | 'middle',
        amount: number,
        reverse: boolean = false,
    ): Promise<Fraction> {
        const FXPath = await this.getFXPath(from, to);
        if (reverse) FXPath.path = FXPath.path.reverse();

        let current = from;
        let result = fraction(amount);

        try {
            for (const next of FXPath.path) {
                result = await this.convertDirect(
                    current,
                    next,
                    type,
                    result,
                    reverse,
                );
                current = next;
            }
        } catch (e) {
            throw new Error(
                `Cannot convert from ${from} to ${to} with ${type}: \n${e.message}`,
            );
        }

        return result;
    }

    public async getUpdatedDate(from: currency, to: currency): Promise<Date> {
        if (!(await this.fxRateList[from][to])) {
            throw new Error(`FX Path from ${from} to ${to} not found`);
        }
        return (await this.fxRateList[from][to]).updated;
    }
}
