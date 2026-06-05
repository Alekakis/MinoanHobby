import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

// Ducks behave as a uniform pool. This endpoint provides reserve/release/confirm actions
// using per-order hold keys with TTL so items are automatically returned to stock when
// the hold expires. Admins can manually delete hold keys or adjust counters in Redis.

const STOCK_KEY = 'SELECT:ducks:stock';
const HOLD_PREFIX = 'SELECT:ducks:hold'; // hold keys: SELECT:ducks:hold:{cartId}
const HOLD_INDEX_KEY = 'SELECT:ducks:holdIndex';
const HOLD_COUNT_KEY = 'SELECT:ducks:holdCount';
const SOLD_COUNT_KEY = 'SELECT:ducks:soldCount';
const MAX_STOCK = 12;
const HOLD_TTL = 10 * 60; // 10 minutes in seconds

function makeHoldKey(cartId) {
    return `${HOLD_PREFIX}:${cartId}`;
}

async function cleanupExpiredHolds() {
    const now = Date.now();
    const index = await redis.hgetall(HOLD_INDEX_KEY);
    const expired = [];
    const activeKeys = await redis.keys(`${HOLD_PREFIX}:*`);

    for (const key of activeKeys) {
        const cartId = key.replace(`${HOLD_PREFIX}:`, '');
        if (index[cartId]) continue;

        const [qty, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
        const parsedQty = Number(qty || 0);
        if (parsedQty <= 0) continue;

        const expiresAt = ttl > 0
            ? now + (ttl * 1000)
            : now + (HOLD_TTL * 1000);

        index[cartId] = JSON.stringify({ qty: parsedQty, expiresAt });
        await redis.hset(HOLD_INDEX_KEY, cartId, index[cartId]);
        if (ttl < 0) await redis.expire(key, HOLD_TTL);
    }

    for (const [cartId, raw] of Object.entries(index || {})) {
        let hold;
        try {
            hold = JSON.parse(raw);
        } catch (e) {
            expired.push({ cartId, qty: 0 });
            continue;
        }

        if (Number(hold.expiresAt || 0) <= now) {
            expired.push({ cartId, qty: Number(hold.qty || 0) });
        }
    }

    if (expired.length === 0) return;

    const p = redis.pipeline();
    for (const item of expired) {
        p.del(makeHoldKey(item.cartId));
        p.hdel(HOLD_INDEX_KEY, item.cartId);
        if (item.qty > 0) {
            p.decrby(HOLD_COUNT_KEY, item.qty);
            p.incrby(STOCK_KEY, item.qty);
        }
    }
    await p.exec();
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // ensure initialization
        const exists = await redis.exists(STOCK_KEY);
        if (!exists) await redis.set(STOCK_KEY, MAX_STOCK);
        await cleanupExpiredHolds();

        if (req.method === 'GET') {
            const [stock, holdCount, soldCount] = await redis.mget(STOCK_KEY, HOLD_COUNT_KEY, SOLD_COUNT_KEY);

            // get a list of active holds (keys and ttls) - limited to first 100
            const keys = await redis.keys(`${HOLD_PREFIX}:*`);
            const p = redis.pipeline();
            keys.forEach(k => { p.get(k); p.ttl(k); });
            const results = await p.exec();
            const holds = [];
            for (let i = 0; i < keys.length; i++) {
                const value = (results[i * 2] && results[i * 2][1]) || null;
                const ttl = (results[i * 2 + 1] && results[i * 2 + 1][1]);
                holds.push({ key: keys[i], value, ttl });
            }

            return res.status(200).json({
                stock: Number(stock || 0),
                held: Number(holdCount || 0),
                sold: Number(soldCount || 0),
                holds
            });
        }

        if (req.method === 'POST') {
            let body = req.body;
            if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }

            const { action, qty = 1, cartId } = body || {};

            if (!action) return res.status(400).json({ error: 'action required' });

            if (action === 'reserve') {
                const requested = parseInt(qty, 10) || 1;
                const id = cartId || `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
                const holdKey = makeHoldKey(id);

                // check existing hold for this cartId
                const existing = await redis.get(holdKey);
                // ensure enough free stock for the additional amount
                const currentStock = parseInt(await redis.get(STOCK_KEY) || '0', 10);
                if (currentStock < requested) return res.status(400).json({ error: 'no_stock' });

                // decrement stock for the additional quantity
                const newStock = await redis.decrby(STOCK_KEY, requested);
                if (newStock < 0) {
                    await redis.incrby(STOCK_KEY, requested);
                    return res.status(400).json({ error: 'no_stock' });
                }

                if (existing) {
                    const newQty = parseInt(existing || '0', 10) + requested;
                    await redis.set(holdKey, String(newQty), 'EX', HOLD_TTL);
                    await redis.hset(HOLD_INDEX_KEY, id, JSON.stringify({
                        qty: newQty,
                        expiresAt: Date.now() + (HOLD_TTL * 1000)
                    }));
                } else {
                    await redis.set(holdKey, String(requested), 'EX', HOLD_TTL);
                    await redis.hset(HOLD_INDEX_KEY, id, JSON.stringify({
                        qty: requested,
                        expiresAt: Date.now() + (HOLD_TTL * 1000)
                    }));
                }

                await redis.incrby(HOLD_COUNT_KEY, requested);

                return res.status(200).json({ success: true, reserved: true, id, qty: requested, ttl: HOLD_TTL });
            }

            if (action === 'release') {
                // release a hold back to stock. If cartId given, release that hold. Otherwise release qty from general pool.
                if (cartId) {
                    const holdKey = makeHoldKey(cartId);
                    const val = await redis.get(holdKey);
                    if (!val) return res.status(200).json({ success: true, released: false, reason: 'not_found' });
                    const q = parseInt(val || '0', 10) || 0;
                    await redis.del(holdKey);
                    await redis.hdel(HOLD_INDEX_KEY, cartId);
                    await redis.decrby(HOLD_COUNT_KEY, q);
                    await redis.incrby(STOCK_KEY, q);
                    return res.status(200).json({ success: true, released: true, qty: q });
                }

                // release generic qty from hold back to stock
                const requested = parseInt(qty, 10) || 1;
                const holdCount = parseInt(await redis.get(HOLD_COUNT_KEY) || '0', 10);
                if (holdCount <= 0) return res.status(400).json({ error: 'no_held_items' });
                const toRelease = Math.min(requested, holdCount);
                await redis.decrby(HOLD_COUNT_KEY, toRelease);
                await redis.incrby(STOCK_KEY, toRelease);
                return res.status(200).json({ success: true, released: true, qty: toRelease });
            }

            if (action === 'confirm') {
                // confirm a hold into sold. If cartId provided, convert that hold. Otherwise convert qty from holds.
                if (cartId) {
                    const holdKey = makeHoldKey(cartId);
                    const val = await redis.get(holdKey);
                    if (!val) return res.status(200).json({ success: true, confirmed: false, reason: 'not_found' });
                    const q = parseInt(val || '0', 10) || 0;
                    await redis.del(holdKey);
                    await redis.hdel(HOLD_INDEX_KEY, cartId);
                    await redis.decrby(HOLD_COUNT_KEY, q);
                    await redis.incrby(SOLD_COUNT_KEY, q);
                    return res.status(200).json({ success: true, confirmed: true, qty: q });
                }

                const requested = parseInt(qty, 10) || 1;
                const holdCount = parseInt(await redis.get(HOLD_COUNT_KEY) || '0', 10);
                if (holdCount <= 0) return res.status(400).json({ error: 'no_held_items' });
                const toConfirm = Math.min(requested, holdCount);
                await redis.decrby(HOLD_COUNT_KEY, toConfirm);
                await redis.incrby(SOLD_COUNT_KEY, toConfirm);
                return res.status(200).json({ success: true, confirmed: true, qty: toConfirm });
            }

            return res.status(400).json({ error: 'invalid action' });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
