import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

const HOLD_TTL = 10 * 60;
const ORDER_DETAILS_TTL = 60 * 60 * 24 * 7;

const POOLED_PRODUCTS = {
    ducks: {
        stockKey: 'SELECT:ducks:stock',
        holdPrefix: 'SELECT:ducks:hold',
        holdIndexKey: 'SELECT:ducks:holdIndex',
        holdCountKey: 'SELECT:ducks:holdCount',
        pendingKey: 'viva:pending:ducks',
        mappingKey: 'viva:mapping:ducks',
        maxStock: 12
    },
    merlinBox: {
        stockKey: 'SELECT:merlin-box:stock',
        holdPrefix: 'SELECT:merlin-box:hold',
        holdIndexKey: 'SELECT:merlin-box:holdIndex',
        holdCountKey: 'SELECT:merlin-box:holdCount',
        pendingKey: 'viva:pending:merlinBox',
        mappingKey: 'viva:mapping:merlinBox',
        maxStock: 12
    },
    merlinPack: {
        stockKey: 'SELECT:merlin-pack:stock',
        holdPrefix: 'SELECT:merlin-pack:hold',
        holdIndexKey: 'SELECT:merlin-pack:holdIndex',
        holdCountKey: 'SELECT:merlin-pack:holdCount',
        pendingKey: 'viva:pending:merlinPack',
        mappingKey: 'viva:mapping:merlinPack',
        maxStock: 12
    },
    randomEuroleagueBox: {
        stockKey: 'SELECT:random-euroleague-box:stock',
        holdPrefix: 'SELECT:random-euroleague-box:hold',
        holdIndexKey: 'SELECT:random-euroleague-box:holdIndex',
        holdCountKey: 'SELECT:random-euroleague-box:holdCount',
        pendingKey: 'viva:pending:randomEuroleagueBox',
        mappingKey: 'viva:mapping:randomEuroleagueBox',
        maxStock: 21
    },
    randomFootballBox: {
        stockKey: 'SELECT:random-football-box:stock',
        holdPrefix: 'SELECT:random-football-box:hold',
        holdIndexKey: 'SELECT:random-football-box:holdIndex',
        holdCountKey: 'SELECT:random-football-box:holdCount',
        pendingKey: 'viva:pending:randomFootballBox',
        mappingKey: 'viva:mapping:randomFootballBox',
        maxStock: 30
    },
    euroleagueMegaBox: {
        stockKey: 'product:stock:euroleague',
        holdPrefix: 'SELECT:euroleague-mega-box:hold',
        holdIndexKey: 'SELECT:euroleague-mega-box:holdIndex',
        holdCountKey: 'SELECT:euroleague-mega-box:holdCount',
        pendingKey: 'viva:pending:euroleagueMegaBox',
        mappingKey: 'viva:mapping:euroleagueMegaBox',
        maxStock: 10
    },
    origins: {
        stockKey: 'SELECT:origins:stock',
        holdPrefix: 'SELECT:origins:hold',
        holdIndexKey: 'SELECT:origins:holdIndex',
        holdCountKey: 'SELECT:origins:holdCount',
        pendingKey: 'viva:pending:origins',
        mappingKey: 'viva:mapping:origins',
        maxStock: 20
    },
    topload: {
        stockKey: 'SELECT:topload:stock',
        holdPrefix: 'SELECT:topload:hold',
        holdIndexKey: 'SELECT:topload:holdIndex',
        holdCountKey: 'SELECT:topload:holdCount',
        pendingKey: 'viva:pending:topload',
        mappingKey: 'viva:mapping:topload',
        maxStock: 50
    }
};

function normalizeProductId(item) {
    const value = String(item.teamId || item.name || '').toLowerCase();

    if (value === 'ducks') return 'ducks';
    if (value.includes('merlin') && value.includes('pack')) return 'merlinPack';
    if (value.includes('merlin')) return 'merlinBox';
    if (value === 'panini select' || value === 'randomeuroleaguebox') return 'randomEuroleagueBox';
    if (value === 'football box' || value === 'randomfootballbox') return 'randomFootballBox';
    if (value === '2025-26 panini euroleague contenders basketball mega box') return 'euroleagueMegaBox';
    if (value.includes('origins') && value.includes('euroleague')) return 'origins';
    if (value.includes('topload') && value.includes('card holder')) return 'topload';

    return null;
}

function isShippingItem(item) {
    const name = String(item.name || item.teamId || '').toLowerCase();
    return name.includes('shipping') || name.includes('αποστολ') || name.includes('Î±Ï€Î¿ÏƒÏ„Î¿Î»');
}

function holdKey(config, cartId) {
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
        p.del(holdKey(config, item.cartId));
        p.hdel(config.holdIndexKey, item.cartId);
        if (item.qty > 0) {
            p.decrby(config.holdCountKey, item.qty);
            p.incrby(config.stockKey, item.qty);
        }
    }
    await p.exec();
}

async function reservePooledProduct(productId, cartId, qty) {
    const config = POOLED_PRODUCTS[productId];
    const requested = parseInt(qty, 10) || 1;
    const key = holdKey(config, cartId);

    const exists = await redis.exists(config.stockKey);
    if (!exists) await redis.set(config.stockKey, config.maxStock);

    await cleanupExpiredHolds(config);

    const currentStock = parseInt(await redis.get(config.stockKey) || '0', 10);
    if (currentStock < requested) {
        throw new Error('Το προϊόν δεν έχει αρκετό διαθέσιμο απόθεμα');
    }

    const newStock = await redis.decrby(config.stockKey, requested);
    if (newStock < 0) {
        await redis.incrby(config.stockKey, requested);
        throw new Error('Το προϊόν δεν έχει αρκετό διαθέσιμο απόθεμα');
    }

    const existing = parseInt(await redis.get(key) || '0', 10);
    const newQty = existing + requested;

    await redis.set(key, String(newQty), 'EX', HOLD_TTL);
    await redis.hset(config.holdIndexKey, cartId, JSON.stringify({
        qty: newQty,
        expiresAt: Date.now() + (HOLD_TTL * 1000)
    }));
    await redis.incrby(config.holdCountKey, requested);

    return { productId, qty: requested, cartId };
}

async function releasePooledReservation(reservation) {
    const config = POOLED_PRODUCTS[reservation.productId];
    const key = holdKey(config, reservation.cartId);
    const current = parseInt(await redis.get(key) || '0', 10);
    const qty = Math.min(current || reservation.qty, reservation.qty);

    if (qty <= 0) return;

    if (current > qty) {
        const remaining = current - qty;
        await redis.set(key, String(remaining), 'EX', HOLD_TTL);
        await redis.hset(config.holdIndexKey, reservation.cartId, JSON.stringify({
            qty: remaining,
            expiresAt: Date.now() + (HOLD_TTL * 1000)
        }));
    } else {
        await redis.del(key);
        await redis.hdel(config.holdIndexKey, reservation.cartId);
    }

    await redis.decrby(config.holdCountKey, qty);
    await redis.incrby(config.stockKey, qty);
}

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let body = req.body;

    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch (e) {}
    }

    const {
        amount,
        teamId,
        qty,
        cartId,
        items,
        firstName,
        lastName,
        email,
        phone,
        address,
        city,
        zip
    } = body || {};

    const lowerTeamId = String(teamId || '').toLowerCase();
    const orderItems = Array.isArray(items) && items.length > 0
        ? items
        : [{ name: teamId, teamId, qty: qty || 1 }];
    const realItems = orderItems.filter(item => !isShippingItem(item));
    const reservations = [];

    try {
        if (!amount || !teamId || !cartId) {
            throw new Error('Missing required fields');
        }

        for (const item of realItems) {
            const productId = normalizeProductId(item);
            if (productId) {
                reservations.push(await reservePooledProduct(productId, cartId, item.qty || 1));
            }
        }

        const isBoxOrProduct =
    isShippingItem({ name: teamId, teamId }) ||
    [
        'ducks',
        'megabox half case',
        '2025-26 panini euroleague contenders basketball mega box',
        'panini euroleague select box',
        'panini la liga select box',
        'panini select',
        'football box',
        'mixed-cart',
        'shipping-only'
    ].includes(lowerTeamId) || lowerTeamId.includes('merlin') || lowerTeamId.includes('origins') || lowerTeamId.includes('topload');

        if (!isBoxOrProduct) {
            const teamKey = `SELECT:team:${teamId}`;
            const sold = await redis.get(`SELECT:team:sold:${teamId}`);

            if (sold) throw new Error('Το spot έχει εξαντληθεί!');

            const stock = await redis.hget(teamKey, 'stock');
            const hold = await redis.hget(teamKey, 'hold');

            if (String(stock) !== '1') throw new Error('Το spot δεν είναι διαθέσιμο');

            if (String(hold) !== '1') throw new Error('Το spot δεν είναι δεσμευμένο');

            const holdCart = await redis.hget(teamKey, 'holdCart');
            if (cartId && holdCart && String(holdCart) !== String(cartId)) {
                throw new Error('Το spot έχει κρατηθεί από άλλον χρήστη');
            }
        }

        const auth = Buffer.from(`${process.env.VIVA_CLIENT_ID || 'db03347e-8d36-4139-83cd-d45449e2d44c'}:${process.env.VIVA_CLIENT_SECRET || '05dreaYv174ROJz6NHvqZ4RtO8SU5P'}`).toString('base64');

        let data;
        try {
            const vivaResponse = await fetch('https://www.vivapayments.com/api/orders', {
                method: 'POST',
                headers: {
                    Authorization: `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                body: new URLSearchParams({
                    Amount: Math.round(parseFloat(amount) * 100).toString(),
                    CustomerTrns: 'Minoan Hobby Order',
                    SourceCode: '4936'
                })
            });

            data = await vivaResponse.json();
        } catch (e) {
            throw e;
        }

        if (!data || !data.OrderCode) {
            for (const reservation of reservations) {
                await releasePooledReservation(reservation);
            }
            return res.status(500).json({ error: 'Παρουσιάστηκε σφάλμα στη σύνδεση με την Viva. Παρακαλώ δοκιμάστε ξανά.' });
        }

        const customerData = {
            firstName,
            lastName,
            email,
            phone,
            address,
            city,
            zip,
            teamName: teamId,
            price: amount,
            items: realItems
        };

           await redis.set(
        `viva:order:details:${data.OrderCode}`,
        JSON.stringify(customerData),
        'EX',
        ORDER_DETAILS_TTL
    );

        for (const reservation of reservations) {
            const config = POOLED_PRODUCTS[reservation.productId];
            await redis.set(`${config.pendingKey}:${data.OrderCode}`, reservation.qty, 'EX', HOLD_TTL);
            await redis.set(`${config.mappingKey}:${data.OrderCode}`, String(cartId), 'EX', HOLD_TTL);
        }

        if (lowerTeamId === 'megabox half case') {
            await redis.set(`viva:pending:megabox:${data.OrderCode}`, qty || 1, 'EX', HOLD_TTL);
        } else if (lowerTeamId.includes('euroleague contenders') && !normalizeProductId({ teamId })) {
            await redis.set(`viva:pending:euroleague:${data.OrderCode}`, qty || 1, 'EX', HOLD_TTL);
        } else if (lowerTeamId.includes('euroleague select')) {
            await redis.set(`viva:pending:select:${data.OrderCode}`, qty || 1, 'EX', HOLD_TTL);
        } else if (lowerTeamId.includes('la liga')) {
            await redis.set(`viva:pending:laliga:${data.OrderCode}`, qty || 1, 'EX', HOLD_TTL);
        } else if (lowerTeamId !== 'shipping-only' && !normalizeProductId({ teamId })) {
            await redis.set(`viva:mapping:team:${data.OrderCode}`, String(teamId), 'EX', HOLD_TTL);
        }

        (async () => {
            try {
                await fetch('https://api.web3forms.com/submit', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        access_key: "ef54407f-a593-41c3-8fce-209c5ebf6e97",
                        subject: 'Νέα Παραγγελία: ' + (customerData.firstName || ''),
                        'Order Code': data.OrderCode,
                        'Ονομα': (customerData.firstName || '') + ' ' + (customerData.lastName || ''),
                        'Email': customerData.email || '',
                        'Τηλέφωνο': customerData.phone || '',
                        'Διεύθυνση': customerData.address || '',
                        'Πόλη': customerData.city || '',
                        'ΤΚ': customerData.zip || '',
                        'Είδος': customerData.teamName || 'Άγνωστο',
                        'Ποσό': (customerData.price || '0') + ' €'
                    })
                });
            } catch (e) {
                console.error('Web3Forms notify failed:', e);
            }

            try {
                await fetch('https://formspree.io/f/xgoqqppn', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        subject: 'Νέα Παραγγελία (Formspree)',
                        'Order Code': data.OrderCode,
                        'Ονομα': (customerData.firstName || '') + ' ' + (customerData.lastName || ''),
                        'Email': customerData.email || '',
                        'Τηλέφωνο': customerData.phone || '',
                        'Διεύθυνση': customerData.address || '',
                        'Πόλη': customerData.city || '',
                        'ΤΚ': customerData.zip || '',
                        'Είδος': customerData.teamName || 'Άγνωστο',
                        'Ποσό': (customerData.price || '0') + ' €'
                    })
                });
            } catch (e) {
                console.error('Formspree notify failed:', e);
            }
        })();

        return res.status(200).json(data);
    } catch (error) {
        for (const reservation of reservations) {
            try {
                await releasePooledReservation(reservation);
            } catch (e) {}
        }

        return res.status(500).json({ error: error.message });
    }
}
