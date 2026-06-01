import Redis from 'ioredis';

const redis = new Redis(
    "redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020"
);

export default async function handler(req, res) {

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader(
        'Access-Control-Allow-Methods',
        'GET, POST, OPTIONS'
    );
    res.setHeader(
        'Access-Control-Allow-Headers',
        'Content-Type'
    );

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const REDIS_KEY =
        'product:stock:box_euroleague';

    try {

        // GET STOCK
        if (req.method === 'GET') {

            const exists =
                await redis.exists(REDIS_KEY);

            if (!exists) {

                await redis.set(
                    REDIS_KEY,
                    10
                );
            }

            const stock =
                parseInt(
                    await redis.get(
                        REDIS_KEY
                    )
                ) || 0;

            return res.status(200).json({
                stock
            });
        }

        // POST ACTIONS
        if (req.method === 'POST') {

            let body = req.body;

            if (
                typeof body === 'string'
            ) {
                try {
                    body = JSON.parse(body);
                } catch (e) {}
            }

            const { action } =
                body || {};

            const exists =
                await redis.exists(
                    REDIS_KEY
                );

            if (!exists) {

                await redis.set(
                    REDIS_KEY,
                    10
                );
            }

            const currentStock =
                parseInt(
                    await redis.get(
                        REDIS_KEY
                    )
                ) || 0;

            // ADD
            if (action === 'add') {

                if (
                    currentStock <= 0
                ) {

                    return res
                        .status(400)
                        .json({
                            error:
                                'Το προϊόν εξαντλήθηκε!'
                        });
                }

                const newStock =
                    await redis.decr(
                        REDIS_KEY
                    );

                return res
                    .status(200)
                    .json({
                        success: true,
                        stock: newStock
                    });
            }

            // REMOVE
            if (
                action === 'remove'
            ) {

                const newStock =
                    await redis.incr(
                        REDIS_KEY
                    );

                return res
                    .status(200)
                    .json({
                        success: true,
                        stock: newStock
                    });
            }

            return res.status(400).json({
                error: 'Invalid action'
            });
        }

        return res.status(405).json({
            error: 'Method not allowed'
        });

    } catch (error) {

        return res.status(500).json({
            error: error.message
        });
    }
}
