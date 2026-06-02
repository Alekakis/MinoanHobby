import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");


export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'GET') {
        return res.status(405).json({
            error: 'Method not allowed'
        });
    }

    try {
        const stocks = {};
        const debug = {};

        for (let i = 1; i <= 23; i++) {
            const soldKey = `team:sold:${i}`;
            const holdKey = `team:hold:${i}`;
            const oldStockKey = `team:stock:${i}`;

            const sold = await redis.get(soldKey);
            const hold = await redis.get(holdKey);
            const oldStock = await redis.get(oldStockKey);
            const holdTtl = await redis.ttl(holdKey);

            stocks[i] = sold || hold ? 0 : 1;

            debug[i] = {
                soldKey,
                sold,
                holdKey,
                hold,
                holdTtl,
                oldStockKey,
                oldStock,
                stockReturned: stocks[i]
            };
        }

        return res.status(200).json({
            stocks,
            debug
        });

    } catch (error) {
        return res.status(500).json({
            error: error.message
        });
    }
}