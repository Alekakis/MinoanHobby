import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

const TEAM_COUNT = 23;
const HOLD_TTL = 7 * 60; // seconds
const SELECT_PREFIX = 'SELECT';

async function ensureSelectMapping() {
    for (let i = 1; i <= TEAM_COUNT; i++) {
        const key = `${SELECT_PREFIX}:team:${i}`;

        await redis.hsetnx(key, 'id', String(i));
        await redis.hsetnx(key, 'maxStock', '1');
        await redis.hsetnx(key, 'name', `Team ${i}`);
    }
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        await ensureSelectMapping();

        if (req.method === 'GET') {
            const stocks = {};
            const teams = {};
            const debug = {};

            for (let i = 1; i <= TEAM_COUNT; i++) {
                const teamKey = `${SELECT_PREFIX}:team:${i}`;
                const soldKey = `${SELECT_PREFIX}:team:sold:${i}`;
                const holdKey = `${SELECT_PREFIX}:team:hold:${i}`;

                const team = await redis.hgetall(teamKey);
                const sold = await redis.get(soldKey);
                const hold = await redis.get(holdKey);
                const holdTtl = await redis.ttl(holdKey);

                teams[i] = {
                    id: Number(team.id),
                    name: team.name,
                    maxStock: Number(team.maxStock)
                };

                if (sold) {
                    stocks[i] = 'sold';
                } else if (hold) {
                    stocks[i] = 'held';
                } else {
                    stocks[i] = 'available';
                }

                debug[i] = {
                    teamKey,
                    soldKey,
                    sold,
                    holdKey,
                    hold,
                    holdTtl,
                    stockReturned: stocks[i]
                };
            }

            return res.status(200).json({ teams, stocks, debug });
        }

        if (req.method === 'POST') {
            let body = req.body;
            if (typeof body === 'string') {
                try { body = JSON.parse(body); } catch (e) {}
            }

            const { action, teamId, cartId } = body || {};
            if (!teamId) return res.status(400).json({ error: 'teamId required' });

            const tid = Number(teamId);
            if (!tid || tid < 1 || tid > TEAM_COUNT) {
                return res.status(400).json({ error: 'invalid teamId' });
            }

            const teamKey = `${SELECT_PREFIX}:team:${tid}`;
            const holdKey = `${SELECT_PREFIX}:team:hold:${tid}`;
            const soldKey = `${SELECT_PREFIX}:team:sold:${tid}`;

            const maxStock = Number(await redis.hget(teamKey, 'maxStock') || 1);

            if (action === 'reserve') {
                if (maxStock <= 0) {
                    return res.status(400).json({ error: 'no_stock' });
                }

                const sold = await redis.get(soldKey);
                if (sold) return res.status(400).json({ error: 'sold' });

                const result = await redis.set(
                    holdKey,
                    String(cartId || 'unknown'),
                    'EX',
                    HOLD_TTL,
                    'NX'
                );

                if (result === 'OK') {
                    return res.status(200).json({
                        success: true,
                        reserved: true,
                        teamId: tid,
                        maxStock,
                        ttl: HOLD_TTL
                    });
                }

                const current = await redis.get(holdKey);
                const ttl = await redis.ttl(holdKey);

                return res.status(409).json({
                    error: 'already_reserved',
                    reservedBy: current,
                    ttl
                });
            }

            if (action === 'release') {
                const current = await redis.get(holdKey);

                if (!current) {
                    return res.status(200).json({
                        success: true,
                        released: false,
                        reason: 'not_found'
                    });
                }

                if (cartId && current !== String(cartId)) {
                    return res.status(403).json({
                        error: 'forbidden',
                        ownedBy: current
                    });
                }

                await redis.del(holdKey);

                return res.status(200).json({
                    success: true,
                    released: true
                });
            }

            return res.status(400).json({ error: 'invalid action' });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
