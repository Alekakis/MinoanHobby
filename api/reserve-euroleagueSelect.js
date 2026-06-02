import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
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

                stocks[i] = sold || hold ? 0 : 1;
            }

            return res.status(200).json({ stocks });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}