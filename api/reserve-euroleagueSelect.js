import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        if (req.method === 'GET') {
            let status = {};

            for (let i = 1; i <= 23; i++) {
                const key = `team:stock:${i}`;
                let stock = await redis.get(key);

                if (stock === null) {
                    stock = 0;
                }

                status[i] = parseInt(stock);
            }

            return res.status(200).json({ stocks: status });
        }

        if (req.method === 'POST') {
            let body = req.body;

            if (typeof body === 'string') {
                try {
                    body = JSON.parse(body);
                } catch (e) {}
            }

            const { teamId, action } = body || {};

            if (!teamId) {
                return res.status(400).json({ error: 'Missing teamId' });
            }

            const KEY = `team:stock:${teamId}`;
            const HOLD_KEY = `team:hold:${teamId}`;
            const currentStock = parseInt(await redis.get(KEY) ?? '1');

            if (action === 'add') {
                if (currentStock <= 0) {
                    return res.status(400).json({
                        error: 'Εξαντλήθηκε!'
                    });
                }

                await redis.set(KEY, 0);
                await redis.set(HOLD_KEY, 1, 'EX', 420);

                return res.status(200).json({
                    success: true,
                    stock: 0
                });
            }

            if (action === 'remove') {
                const holdExists = await redis.get(HOLD_KEY);

                if (holdExists) {
                    await redis.set(KEY, 1);
                    await redis.del(HOLD_KEY);
                }

                return res.status(200).json({
                    success: true,
                    stock: parseInt(await redis.get(KEY) ?? '0')
                });
            }

            return res.status(400).json({
                error: 'Invalid action'
            });
        }

        return res.status(405).json({
            error: 'Method not allowed'
        });

    } catch (error) {
        return res.status(500).json({
            error: error.message
        });
    }
}
