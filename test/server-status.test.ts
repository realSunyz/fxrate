import { makeInstance, Manager } from '../src/index';
import { useInternalRestAPI } from '../src/fxmManager';
import { rootRouter } from 'handlers.js';

const Instance = await makeInstance(new rootRouter(), Manager);

describe('Server Status', () => {
    test('/info', async () => {
        const res = await useInternalRestAPI('info', Instance);
        expect(res.status).toEqual('ok');
    });
});

afterAll((t) => {
    Manager.stopAllInterval();
    t();
});
