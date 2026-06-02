export default async function handler(req, res) {
    console.log('VIVA WEBHOOK METHOD:', req.method);
    console.log('VIVA WEBHOOK QUERY:', req.query);

    if (req.method === 'GET') {
        return res.status(200).json({
            status: 'ok'
        });
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method not allowed'
        });
    }

    try {
        const response = await fetch(
            `${process.env.SITE_URL}/api/process-viva-event`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'x-internal-secret': process.env.INTERNAL_API_SECRET
                },
                body: JSON.stringify(req.body || {})
            }
        );

        const data = await response.json().catch(() => ({}));

        return res.status(200).json({
            received: true,
            processed: response.ok,
            result: data
        });

    } catch (error) {
        console.error('Webhook forward error:', error);

        return res.status(200).json({
            received: true,
            processed: false,
            error: error.message
        });
    }
}
