import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    try {
        if (req.method === 'GET') {
            const stocks = {};

            for (let i = 1; i <= 23; i++) {
                const sold = await redis.get(`team:sold:${i}`);
                const hold = await redis.get(`team:hold:${i}`);
                const oldStock = await redis.get(`team:stock:${i}`);

                // Migration-safe:
                // - new system: team:sold / team:hold
                // - old system: team:stock = 0 means already sold/reserved
                stocks[i] = sold || hold || oldStock === '0' ? 0 : 1;
            }

            return res.status(200).json({ stocks });
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

            const SOLD_KEY = `team:sold:${teamId}`;
            const HOLD_KEY = `team:hold:${teamId}`;
            const OLD_STOCK_KEY = `team:stock:${teamId}`;

            if (action === 'add') {
                const sold = await redis.get(SOLD_KEY);
                const hold = await redis.get(HOLD_KEY);
                const oldStock = await redis.get(OLD_STOCK_KEY);

                if (sold || oldStock === '0') {
                    return res.status(400).json({
                        error: 'Η ομάδα έχει πουληθεί!'
                    });
                }

                if (hold) {
                    return res.status(400).json({
                        error: 'Η ομάδα είναι δεσμευμένη!'
                    });
                }

                await redis.set(HOLD_KEY, 1, 'EX', 420);

                return res.status(200).json({
                    success: true,
                    stock: 0
                });
            }

            if (action === 'remove') {
                const sold = await redis.get(SOLD_KEY);
                const oldStock = await redis.get(OLD_STOCK_KEY);

                // Αν έχει πουληθεί μόνιμα, δεν το απελευθερώνουμε.
                if (!sold && oldStock !== '0') {
                    await redis.del(HOLD_KEY);
                }

                return res.status(200).json({
                    success: true,
                    stock: sold || oldStock === '0' ? 0 : 1
                });
            }

            return res.status(400).json({ error: 'Invalid action' });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
