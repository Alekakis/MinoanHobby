import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");


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
                console.error('Formspree notify failed (process-viva-event):', e);
            }

            await redis.del(
                `viva:pending:ducks:${orderCode}`,
                `viva:pending:megabox:${orderCode}`,
                `viva:pending:euroleague:${orderCode}`,
                `viva:pending:select:${orderCode}`,
                `viva:pending:laliga:${orderCode}`
            );

            const cartId = await redis.get(`viva:mapping:ducks:${orderCode}`);
            if (cartId) {
                const holdKey = `SELECT:ducks:hold:${cartId}`;
                const val = await redis.get(holdKey);
                if (val) {
                    const q = parseInt(val || '0', 10) || 0;
                    await redis.del(holdKey);
                    await redis.decrby('SELECT:ducks:holdCount', q);
                    await redis.incrby('SELECT:ducks:soldCount', q);
                }
            }

            const teamId =
                await redis.get(
                    `viva:mapping:team:${orderCode}`
                );

            if (teamId && !isNaN(parseInt(teamId))) {
                await redis.set(`SELECT:team:sold:${teamId}`, 1);
                try { await redis.hset(`SELECT:team:${teamId}`, 'stock', '0'); } catch (e) {}
                try { await redis.hset(`SELECT:team:${teamId}`, 'hold', '0'); } catch (e) {}
            }

            await redis.del(
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

            // randomselect removed; Panini Select uses ducks pending key now

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

            const ducksQty =
                await redis.get(
                    `viva:pending:ducks:${orderCode}`
                );

            if (ducksQty) {
                // return ducks stock into SELECT namespace
                await redis.incrby(
                    'SELECT:ducks:stock',
                    parseInt(ducksQty)
                );
            }

            const teamId =
                await redis.get(
                    `viva:mapping:team:${orderCode}`
                );

            if (teamId && !isNaN(parseInt(teamId))) {
                try { await redis.hset(`SELECT:team:${teamId}`, 'hold', '0'); } catch (e) {}
            }

            await redis.del(
                `viva:pending:ducks:${orderCode}`,
                `viva:pending:megabox:${orderCode}`,
                `viva:pending:euroleague:${orderCode}`,
                `viva:pending:select:${orderCode}`,
                `viva:pending:randomselect:${orderCode}`,
                `viva:pending:laliga:${orderCode}`,
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
