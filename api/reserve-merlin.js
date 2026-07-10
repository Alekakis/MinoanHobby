import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

const HOLD_TTL = 10 * 60;

const PRODUCT_CONFIGS = {
    box: {
        stockKey: 'SELECT:merlin-box:stock',
        holdPrefix: 'SELECT:merlin-box:hold',
        holdIndexKey: 'SELECT:merlin-box:holdIndex',
        holdCountKey: 'SELECT:merlin-box:holdCount',
        soldCountKey: 'SELECT:merlin-box:soldCount',
        maxStock: 12,
        pendingKey: 'viva:pending:merlinBox',
        mappingKey: 'viva:mapping:merlinBox'
    },
    pack: {
        stockKey: 'SELECT:merlin-pack:stock',
        holdPrefix: 'SELECT:merlin-pack:hold',
        holdIndexKey: 'SELECT:merlin-pack:holdIndex',
        holdCountKey: 'SELECT:merlin-pack:holdCount',
        soldCountKey: 'SELECT:merlin-pack:soldCount',
        maxStock: 12,
        pendingKey: 'viva:pending:merlinPack',
        mappingKey: 'viva:mapping:merlinPack'
    }
};

function getProductConfig(product) {
    const normalized = String(product || 'box').toLowerCase();
    return PRODUCT_CONFIGS[normalized] || PRODUCT_CONFIGS.box;
}

function makeHoldKey(config, cartId) {
    return `${config.holdPrefix}:${cartId}`;
}

async function cleanupExpiredHolds(config) {
    const now = Date.now();
    const index = await redis.hgetall(config.holdIndexKey);
    const expired = [];
    const activeKeys = await redis.keys(`${config.holdPrefix}:*`);

    for (const key of activeKeys) {
        const cartId = key.replace(`${config.holdPrefix}:`, '');
        if (index[cartId]) continue;

        const [qty, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
        const parsedQty = Number(qty || 0);
        if (parsedQty <= 0) continue;

        const expiresAt = ttl > 0
            ? now + (ttl * 1000)
            : now + (HOLD_TTL * 1000);

        index[cartId] = JSON.stringify({ qty: parsedQty, expiresAt });
        await redis.hset(config.holdIndexKey, cartId, index[cartId]);
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
        p.del(makeHoldKey(config, item.cartId));
        p.hdel(config.holdIndexKey, item.cartId);
        if (item.qty > 0) {
            p.decrby(config.holdCountKey, item.qty);
            p.incrby(config.stockKey, item.qty);
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
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (e) {}
        }

        const queryProduct = req.query && typeof req.query.product === 'string' ? req.query.product : null;
        const bodyProduct = body && typeof body.product === 'string' ? body.product : null;
        const product = queryProduct || bodyProduct || 'box';
        const config = getProductConfig(product);

        const exists = await redis.exists(config.stockKey);
        if (!exists) await redis.set(config.stockKey, config.maxStock);
        await cleanupExpiredHolds(config);

        if (req.method === 'GET') {
            const [stock, holdCount, soldCount] = await redis.mget(config.stockKey, config.holdCountKey, config.soldCountKey);
            const keys = await redis.keys(`${config.holdPrefix}:*`);
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
                product,
                stock: Number(stock || 0),
                held: Number(holdCount || 0),
                sold: Number(soldCount || 0),
                holds
            });
        }

        if (req.method === 'POST') {
            const { action, qty = 1, cartId, product: requestProduct } = body || {};
            if (!action) return res.status(400).json({ error: 'action required' });

            const activeConfig = getProductConfig(requestProduct || product);
            if (action === 'reserve') {
                const requested = parseInt(qty, 10) || 1;
                const id = cartId || `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
                const holdKey = makeHoldKey(activeConfig, id);

                const existing = await redis.get(holdKey);
                const currentStock = parseInt(await redis.get(activeConfig.stockKey) || '0', 10);
                if (currentStock < requested) return res.status(400).json({ error: 'no_stock' });

                const newStock = await redis.decrby(activeConfig.stockKey, requested);
                if (newStock < 0) {
                    await redis.incrby(activeConfig.stockKey, requested);
                    return res.status(400).json({ error: 'no_stock' });
                }

                if (existing) {
                    const newQty = parseInt(existing || '0', 10) + requested;
                    await redis.set(holdKey, String(newQty), 'EX', HOLD_TTL);
                    await redis.hset(activeConfig.holdIndexKey, id, JSON.stringify({
                        qty: newQty,
                        expiresAt: Date.now() + (HOLD_TTL * 1000)
                    }));
                } else {
                    await redis.set(holdKey, String(requested), 'EX', HOLD_TTL);
                    await redis.hset(activeConfig.holdIndexKey, id, JSON.stringify({
                        qty: requested,
                        expiresAt: Date.now() + (HOLD_TTL * 1000)
                    }));
                }

                await redis.incrby(activeConfig.holdCountKey, requested);
                return res.status(200).json({ success: true, reserved: true, product: requestProduct || product, id, qty: requested, ttl: HOLD_TTL });
            }

            if (action === 'release') {
                if (cartId) {
                    const holdKey = makeHoldKey(activeConfig, cartId);
                    const val = await redis.get(holdKey);
                    if (!val) return res.status(200).json({ success: true, released: false, reason: 'not_found' });
                    const q = parseInt(val || '0', 10) || 0;
                    await redis.del(holdKey);
                    await redis.hdel(activeConfig.holdIndexKey, cartId);
                    await redis.decrby(activeConfig.holdCountKey, q);
                    await redis.incrby(activeConfig.stockKey, q);
                    return res.status(200).json({ success: true, released: true, product: requestProduct || product, qty: q });
                }

                const requested = parseInt(qty, 10) || 1;
                const holdCount = parseInt(await redis.get(activeConfig.holdCountKey) || '0', 10);
                if (holdCount <= 0) return res.status(400).json({ error: 'no_held_items' });
                const toRelease = Math.min(requested, holdCount);
                await redis.decrby(activeConfig.holdCountKey, toRelease);
                await redis.incrby(activeConfig.stockKey, toRelease);
                return res.status(200).json({ success: true, released: true, product: requestProduct || product, qty: toRelease });
            }

            if (action === 'confirm') {
                if (cartId) {
                    const holdKey = makeHoldKey(activeConfig, cartId);
                    const val = await redis.get(holdKey);
                    if (!val) return res.status(200).json({ success: true, confirmed: false, reason: 'not_found' });
                    const q = parseInt(val || '0', 10) || 0;
                    await redis.del(holdKey);
                    await redis.hdel(activeConfig.holdIndexKey, cartId);
                    await redis.decrby(activeConfig.holdCountKey, q);
                    await redis.incrby(activeConfig.soldCountKey, q);
                    return res.status(200).json({ success: true, confirmed: true, product: requestProduct || product, qty: q });
                }

                const requested = parseInt(qty, 10) || 1;
                const holdCount = parseInt(await redis.get(activeConfig.holdCountKey) || '0', 10);
                if (holdCount <= 0) return res.status(400).json({ error: 'no_held_items' });
                const toConfirm = Math.min(requested, holdCount);
                await redis.decrby(activeConfig.holdCountKey, toConfirm);
                await redis.incrby(activeConfig.soldCountKey, toConfirm);
                return res.status(200).json({ success: true, confirmed: true, product: requestProduct || product, qty: toConfirm });
            }

            return res.status(400).json({ error: 'invalid action' });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
