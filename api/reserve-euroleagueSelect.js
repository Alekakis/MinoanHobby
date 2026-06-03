import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");


const TEAM_COUNT = 23;
// Hold TTL in seconds (8 hours) - reserved until payment or expiry
const HOLD_TTL = 8 * 60 * 60; // 8 hours
const SELECT_PREFIX = 'SELECT';

async function ensureSelectMapping() {
    for (let i = 1; i <= TEAM_COUNT; i++) {
        const key = `${SELECT_PREFIX}:team:${i}`;

        await redis.hsetnx(key, 'id', String(i));
        await redis.hsetnx(key, 'maxStock', '1');
        await redis.hsetnx(key, 'stock', '1');
        await redis.hsetnx(key, 'name', `Team ${i}`);
        await redis.hsetnx(key, 'hold', '0');
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
                // team.stock can be the string '0' which is falsy; explicitly prefer it when present
                const stockVal = (team && typeof team.stock !== 'undefined' && team.stock !== null && team.stock !== '') ? team.stock : team.maxStock;
                // prefer an explicit hold key (with TTL) when present; fallback to hash field for backward compat
                const holdKeyVal = await redis.get(holdKey);
                const hold = (holdKeyVal ? '1' : (team && team.hold ? String(team.hold) : '0'));
                // include TTL for hold key in debug to help troubleshooting
                const holdTtl = await redis.ttl(holdKey);

                teams[i] = {
                    id: Number(team.id),
                    name: team.name,
                    maxStock: Number(team.maxStock),
                    stock: Number(stockVal || 0)
                };

                // determine state:
                // - if explicit sold key -> sold
                // - else if stock == 1 -> check hold (1 => held, 0 => available)
                // - else -> sold
                let state = 'available';
                if (sold) {
                    state = 'sold';
                } else {
                    const num = parseInt(stockVal || '0', 10);
                    if (num === 1) {
                        if (hold === '1') state = 'held';
                        else state = 'available';
                    } else {
                        state = 'sold';
                    }
                }

                stocks[i] = state;

                debug[i] = {
                    teamKey,
                    soldKey,
                    sold,
                    holdKey,
                    hold,
                    holdTtl,
                    team,
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

                // Simple behavior: use hash 'hold' field = '1'|'0'
                const teamHold = await redis.hget(teamKey, 'hold');
                if (teamHold === '1') {
                    return res.status(409).json({ error: 'already_reserved' });
                }

                // ensure stock is available
                const stockNum = Number(await redis.hget(teamKey, 'stock') || await redis.hget(teamKey, 'maxStock') || 0);
                if (stockNum !== 1) {
                    return res.status(400).json({ error: 'sold' });
                }

                // set hash flag for compatibility
                await redis.hset(teamKey, 'hold', '1');
                // store cartId so we can trace who reserved it
                if (cartId) await redis.hset(teamKey, 'holdCart', String(cartId));
                // also set a dedicated hold key with TTL so it expires automatically
                await redis.set(holdKey, cartId || '1', 'EX', HOLD_TTL);

                // No notification here: email should be sent from create-order to cover full cart

                return res.status(200).json({ success: true, reserved: true, teamId: tid, maxStock, ttl: HOLD_TTL });
            }

            if (action === 'release') {
                // Release by clearing hold flag and deleting hold key
                const teamHold = await redis.hget(teamKey, 'hold');
                if (!teamHold || teamHold === '0') {
                    // still ensure dedicated hold key removed
                    await redis.del(holdKey);
                    await redis.hdel(teamKey, 'holdCart');
                    return res.status(200).json({ success: true, released: false, reason: 'not_found' });
                }

                await redis.hset(teamKey, 'hold', '0');
                await redis.hdel(teamKey, 'holdCart');
                await redis.del(holdKey);
                return res.status(200).json({ success: true, released: true });
            }

            return res.status(400).json({ error: 'invalid action' });
        }

        return res.status(405).json({ error: 'Method not allowed' });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
