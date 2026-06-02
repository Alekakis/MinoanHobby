import Redis from 'ioredis';

const redis = new Redis(process.env.REDIS_URL);

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
                        access_key: process.env.WEB3FORMS_KEY,
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

            await redis.del(
                `viva:pending:ducks:${orderCode}`,
                `viva:pending:megabox:${orderCode}`,
                `viva:pending:euroleague:${orderCode}`,
                `viva:pending:select:${orderCode}`,
                `viva:pending:laliga:${orderCode}`
            );

            const teamId =
                await redis.get(
                    `viva:mapping:team:${orderCode}`
                );

            if (
                teamId &&
                !isNaN(parseInt(teamId))
            ) {
                await redis.set(`team:sold:${teamId}`, 1);
                await redis.del(`team:hold:${teamId}`);
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
                await redis.incrby(
                    'product:stock:ducks',
                    parseInt(ducksQty)
                );
            }

            const teamId =
                await redis.get(
                    `viva:mapping:team:${orderCode}`
                );

            if (
                teamId &&
                !isNaN(parseInt(teamId))
            ) {
                await redis.del(`team:hold:${teamId}`);
               
            }

            await redis.del(
                `viva:pending:ducks:${orderCode}`,
                `viva:pending:megabox:${orderCode}`,
                `viva:pending:euroleague:${orderCode}`,
                `viva:pending:select:${orderCode}`,
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
