import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

const HOLD_TTL = 10 * 60;

const POOLED_PRODUCTS = {
    ducks: {
        holdPrefix: 'SELECT:ducks:hold',
        holdIndexKey: 'SELECT:ducks:holdIndex',
        holdCountKey: 'SELECT:ducks:holdCount',
        soldCountKey: 'SELECT:ducks:soldCount',
        stockKey: 'SELECT:ducks:stock',
        pendingKey: 'viva:pending:ducks',
        mappingKey: 'viva:mapping:ducks'
    },
    merlinBox: {
        holdPrefix: 'SELECT:merlin-box:hold',
        holdIndexKey: 'SELECT:merlin-box:holdIndex',
        holdCountKey: 'SELECT:merlin-box:holdCount',
        soldCountKey: 'SELECT:merlin-box:soldCount',
        stockKey: 'SELECT:merlin-box:stock',
        pendingKey: 'viva:pending:merlinBox',
        mappingKey: 'viva:mapping:merlinBox'
    },
    merlinPack: {
        holdPrefix: 'SELECT:merlin-pack:hold',
        holdIndexKey: 'SELECT:merlin-pack:holdIndex',
        holdCountKey: 'SELECT:merlin-pack:holdCount',
        soldCountKey: 'SELECT:merlin-pack:soldCount',
        stockKey: 'SELECT:merlin-pack:stock',
        pendingKey: 'viva:pending:merlinPack',
        mappingKey: 'viva:mapping:merlinPack'
    },
    randomEuroleagueBox: {
        holdPrefix: 'SELECT:random-euroleague-box:hold',
        holdIndexKey: 'SELECT:random-euroleague-box:holdIndex',
        holdCountKey: 'SELECT:random-euroleague-box:holdCount',
        soldCountKey: 'SELECT:random-euroleague-box:soldCount',
        stockKey: 'SELECT:random-euroleague-box:stock',
        pendingKey: 'viva:pending:randomEuroleagueBox',
        mappingKey: 'viva:mapping:randomEuroleagueBox'
    },
    randomFootballBox: {
        holdPrefix: 'SELECT:random-football-box:hold',
        holdIndexKey: 'SELECT:random-football-box:holdIndex',
        holdCountKey: 'SELECT:random-football-box:holdCount',
        soldCountKey: 'SELECT:random-football-box:soldCount',
        stockKey: 'SELECT:random-football-box:stock',
        pendingKey: 'viva:pending:randomFootballBox',
        mappingKey: 'viva:mapping:randomFootballBox'
    },
    euroleagueMegaBox: {
        holdPrefix: 'SELECT:euroleague-mega-box:hold',
        holdIndexKey: 'SELECT:euroleague-mega-box:holdIndex',
        holdCountKey: 'SELECT:euroleague-mega-box:holdCount',
        soldCountKey: 'SELECT:euroleague-mega-box:soldCount',
        stockKey: 'product:stock:euroleague',
        pendingKey: 'viva:pending:euroleagueMegaBox',
        mappingKey: 'viva:mapping:euroleagueMegaBox'
    },
    origins: {
        holdPrefix: 'SELECT:origins:hold',
        holdIndexKey: 'SELECT:origins:holdIndex',
        holdCountKey: 'SELECT:origins:holdCount',
        soldCountKey: 'SELECT:origins:soldCount',
        stockKey: 'SELECT:origins:stock',
        pendingKey: 'viva:pending:origins',
        mappingKey: 'viva:mapping:origins'
    },
    topload: {
        holdPrefix: 'SELECT:topload:hold',
        holdIndexKey: 'SELECT:topload:holdIndex',
        holdCountKey: 'SELECT:topload:holdCount',
        soldCountKey: 'SELECT:topload:soldCount',
        stockKey: 'SELECT:topload:stock',
        pendingKey: 'viva:pending:topload',
        mappingKey: 'viva:mapping:topload'
    }
};

function holdKey(config, cartId) {
    return `${config.holdPrefix}:${cartId}`;
}

async function confirmPooledProduct(orderCode, config) {
    const cartId = await redis.get(`${config.mappingKey}:${orderCode}`);
    if (!cartId) return;

    const key = holdKey(config, cartId);
    const val = await redis.get(key);
    if (!val) return;

    const heldQty = parseInt(val || '0', 10) || 0;
    const pendingQty = parseInt(await redis.get(`${config.pendingKey}:${orderCode}`) || '0', 10);
    const qty = pendingQty > 0 ? Math.min(heldQty, pendingQty) : heldQty;

    if (qty <= 0) return;

    if (heldQty > qty) {
        const remaining = heldQty - qty;
        await redis.set(key, String(remaining), 'EX', HOLD_TTL);
        await redis.hset(config.holdIndexKey, cartId, JSON.stringify({
            qty: remaining,
            expiresAt: Date.now() + (HOLD_TTL * 1000)
        }));
    } else {
        await redis.del(key);
        await redis.hdel(config.holdIndexKey, cartId);
    }

    await redis.decrby(config.holdCountKey, qty);
    await redis.incrby(config.soldCountKey, qty);
}

async function releasePooledProduct(orderCode, config) {
    const cartId = await redis.get(`${config.mappingKey}:${orderCode}`);
    const pendingQty = parseInt(await redis.get(`${config.pendingKey}:${orderCode}`) || '0', 10);
    if (!cartId && pendingQty <= 0) return;

    if (cartId) {
        const key = holdKey(config, cartId);
        const heldQty = parseInt(await redis.get(key) || '0', 10);
        const qty = pendingQty > 0 ? Math.min(heldQty || pendingQty, pendingQty) : heldQty;

        if (qty > 0) {
            if (heldQty > qty) {
                const remaining = heldQty - qty;
                await redis.set(key, String(remaining), 'EX', HOLD_TTL);
                await redis.hset(config.holdIndexKey, cartId, JSON.stringify({
                    qty: remaining,
                    expiresAt: Date.now() + (HOLD_TTL * 1000)
                }));
            } else {
                await redis.del(key);
                await redis.hdel(config.holdIndexKey, cartId);
            }

            await redis.decrby(config.holdCountKey, qty);
            await redis.incrby(config.stockKey, qty);
        }

        return;
    }

    await redis.incrby(config.stockKey, pendingQty);
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method not allowed'
        });
    }

    if (
        req.headers['x-internal-secret'] !==
        process.env.INTERNAL_API_SECRET
    ) {
        return res.status(401).json({
            error: 'Unauthorized'
        });
    }

    let event = req.body;

    if (typeof event === 'string') {
        try {
            event = JSON.parse(event);
        } catch (e) {}
    }

    try {
        const eventData = event.EventData || {};
        const orderCode = eventData.OrderCode;
        const statusId = eventData.StatusId;
        const eventTypeId = event.EventTypeId;

        if (!orderCode) {
            return res.status(200).json({
                status: 'ignored',
                message: 'No order code'
            });
        }

        if (eventTypeId === 1796 || statusId === 'F') {
            const orderDetailsRaw =
                await redis.get(
                    `viva:order:details:${orderCode}`
                );

            const details = orderDetailsRaw
                ? JSON.parse(orderDetailsRaw)
                : {};

            await fetch(
                'https://api.web3forms.com/submit',
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        access_key: "ef54407f-a593-41c3-8fce-209c5ebf6e97",
                        subject:
                            '💰 Πληρωμένη Παραγγελία: ' +
                            (details.firstName || ''),
                        'Order Code': orderCode,
                        'Ονομα':
                            (details.firstName || '') +
                            ' ' +
                            (details.lastName || ''),
                        'Email': details.email || '',
                        'Τηλέφωνο': details.phone || '',
                        'Διεύθυνση': details.address || '',
                        'Πόλη': details.city || '',
                        'ΤΚ': details.zip || '',
                        'Είδος': details.teamName || 'Άγνωστο',
                        'Ποσό': (details.price || '0') + ' €'
                    })
                }
            );

            // Also notify via Formspree so admin receives a direct mail with Viva OrderCode
            try {
                await fetch('https://formspree.io/f/xgoqqppn', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        subject: 'Πληρωμένη Παραγγελία (Viva): ' + (details.firstName || ''),
                        'Order Code': orderCode,
                        'Ονομα': (details.firstName || '') + ' ' + (details.lastName || ''),
                        'Email': details.email || '',
                        'Τηλέφωνο': details.phone || '',
                        'Είδος': details.teamName || 'Άγνωστο',
                        'Ποσό': (details.price || '0') + ' €'
                    })
                });
            } catch (e) {
                console.error('Formspree notify failed (viva-webhook):', e);
            }

            await confirmPooledProduct(orderCode, POOLED_PRODUCTS.ducks);
            await confirmPooledProduct(orderCode, POOLED_PRODUCTS.merlinBox);
            await confirmPooledProduct(orderCode, POOLED_PRODUCTS.merlinPack);
            await confirmPooledProduct(orderCode, POOLED_PRODUCTS.randomEuroleagueBox);
            await confirmPooledProduct(orderCode, POOLED_PRODUCTS.euroleagueMegaBox);
            await confirmPooledProduct(orderCode, POOLED_PRODUCTS.origins);
            await confirmPooledProduct(orderCode, POOLED_PRODUCTS.topload);
            await confirmPooledProduct(orderCode, POOLED_PRODUCTS.randomFootballBox);

            await redis.del(
                `viva:pending:ducks:${orderCode}`,
                `viva:pending:merlin:${orderCode}`,
                `viva:pending:randomEuroleagueBox:${orderCode}`,
                `viva:pending:randomFootballBox:${orderCode}`,
                `viva:pending:euroleagueMegaBox:${orderCode}`,
                `viva:pending:megabox:${orderCode}`,
                `viva:pending:euroleague:${orderCode}`,
                `viva:pending:select:${orderCode}`,
                `viva:pending:laliga:${orderCode}`,
                `viva:mapping:ducks:${orderCode}`,
                `viva:mapping:merlin:${orderCode}`,
                `viva:mapping:randomEuroleagueBox:${orderCode}`,
                `viva:mapping:euroleagueMegaBox:${orderCode}`,
                `viva:mapping:team:${orderCode}`,
                `viva:order:details:${orderCode}`
            );

            return res.status(200).json({
                status: 'success'
            });
        }

        if (
            statusId === 'E' ||
            statusId === 'X' ||
            statusId === 'C'
        ) {
            const megaboxQty =
                await redis.get(
                    `viva:pending:megabox:${orderCode}`
                );

            if (megaboxQty) {
                await redis.incrby(
                    'product:stock:megabox',
                    parseInt(megaboxQty)
                );
            }

            const euroleagueQty =
                await redis.get(
                    `viva:pending:euroleague:${orderCode}`
                );

            if (euroleagueQty) {
                await redis.incrby(
                    'product:stock:euroleague',
                    parseInt(euroleagueQty)
                );
            }

            const selectQty =
                await redis.get(
                    `viva:pending:select:${orderCode}`
                );

            if (selectQty) {
                await redis.incrby(
                    'product:stock:euroleague_select',
                    parseInt(selectQty)
                );
            }

            const laligaQty =
                await redis.get(
                    `viva:pending:laliga:${orderCode}`
                );

            if (laligaQty) {
                await redis.incrby(
                    'product:stock:laliga_select',
                    parseInt(laligaQty)
                );
            }

            await releasePooledProduct(orderCode, POOLED_PRODUCTS.ducks);
            await releasePooledProduct(orderCode, POOLED_PRODUCTS.merlinBox);
            await releasePooledProduct(orderCode, POOLED_PRODUCTS.merlinPack);
            await releasePooledProduct(orderCode, POOLED_PRODUCTS.randomEuroleagueBox);
            await releasePooledProduct(orderCode, POOLED_PRODUCTS.randomFootballBox);
            await releasePooledProduct(orderCode, POOLED_PRODUCTS.euroleagueMegaBox);
            await releasePooledProduct(orderCode, POOLED_PRODUCTS.origins);
            await releasePooledProduct(orderCode, POOLED_PRODUCTS.topload);


            // If mapping to a team was set, remove team hold
            const teamId = await redis.get(`viva:mapping:team:${orderCode}`);
            if (teamId && !isNaN(parseInt(teamId))) {
                await redis.del(`SELECT:team:hold:${teamId}`);
                try { await redis.hdel(`SELECT:team:${teamId}`, 'hold'); } catch (e) {}
            }

            await redis.del(
                `viva:pending:ducks:${orderCode}`,
                `viva:pending:merlin:${orderCode}`,
                `viva:pending:randomEuroleagueBox:${orderCode}`,
                `viva:pending:euroleagueMegaBox:${orderCode}`,
                `viva:pending:megabox:${orderCode}`,
                `viva:pending:euroleague:${orderCode}`,
                `viva:pending:select:${orderCode}`,
                `viva:pending:laliga:${orderCode}`,
                `viva:mapping:ducks:${orderCode}`,
                `viva:mapping:merlin:${orderCode}`,
                `viva:mapping:randomEuroleagueBox:${orderCode}`,
                `viva:mapping:randomFootballBox:${orderCode}`,
                `viva:mapping:euroleagueMegaBox:${orderCode}`,
                `viva:mapping:team:${orderCode}`,
                `viva:order:details:${orderCode}`
            );

            return res.status(200).json({
                status: 'cancelled'
            });
        }

        return res.status(200).json({
            status: 'received'
        });

    } catch (error) {
        console.error('Process Viva Event Error:', error);

        return res.status(500).json({
            error: error.message
        });
    }
}
