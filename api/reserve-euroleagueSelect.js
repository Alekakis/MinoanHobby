import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // --- GET: return available stocks for each team ---
    if (req.method === 'GET') {
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

            // return explicit state: 'sold' | 'held' | 'available'
            if (sold) {
                stocks[i] = 'sold';
            } else if (hold) {
                stocks[i] = 'held';
            } else {
                stocks[i] = 'available';
            }

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

            return res.status(200).json({ stocks, debug });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // --- POST: reserve or release a team hold ---
    if (req.method === 'POST') {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }

        const { action, teamId, cartId } = body || {};
        if (!teamId) return res.status(400).json({ error: 'teamId required' });

        const tid = Number(teamId);
        if (!tid || tid < 1 || tid > 23) return res.status(400).json({ error: 'invalid teamId' });

        const holdKey = `team:hold:${tid}`;
        const soldKey = `team:sold:${tid}`;
        const HOLD_TTL = 7 * 60; // seconds

        try {
            if (action === 'reserve') {
                const sold = await redis.get(soldKey);
                if (sold) return res.status(400).json({ error: 'sold' });

                // Set hold with NX and expiry
                const result = await redis.set(holdKey, cartId || 'unknown', 'EX', HOLD_TTL, 'NX');
                if (result === 'OK') {
                    return res.status(200).json({ success: true, reserved: true, ttl: HOLD_TTL });
                }

                const current = await redis.get(holdKey);
                const ttl = await redis.ttl(holdKey);
                return res.status(409).json({ error: 'already_reserved', reservedBy: current, ttl });
            }

            if (action === 'release') {
                const current = await redis.get(holdKey);
                if (!current) return res.status(200).json({ success: true, released: false, reason: 'not_found' });

                if (cartId && current !== String(cartId)) {
                    return res.status(403).json({ error: 'forbidden', ownedBy: current });
                }

                await redis.del(holdKey);
                return res.status(200).json({ success: true, released: true });
            }

            return res.status(400).json({ error: 'invalid action' });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
