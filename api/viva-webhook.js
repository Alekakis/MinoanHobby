export default async function handler(req, res) { 
    if (req.method === 'GET') {
    try { const auth = Buffer.from(
    'db03347e-8d36-4139-83cd-d45449e2d44c:05dreaYv174ROJz6NHvqZ4RtO8SU5P'
).toString('base64');

const vivaRes = await fetch(
    'https://www.vivapayments.com/api/messages/config/token',
    {
        method: 'GET',
        headers: {
            Authorization: `Basic ${auth}`
        }
    }
);

            const data = await vivaRes.json();

            return res.status(200).json({
                Key: data.Key
            });

        } catch (error) {
            return res.status(500).json({
                error: error.message
            });
        }
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            error: 'Method not allowed'
        });
    }

    try {
        console.log('VIVA WEBHOOK RECEIVED:', req.body);

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

        console.log('PROCESS VIVA RESPONSE:', {
            ok: response.ok,
            status: response.status,
            data
        });

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
