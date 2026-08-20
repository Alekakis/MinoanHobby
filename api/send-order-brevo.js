const BREVO_API_KEY = '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';
const BREVO_SENDER_EMAIL = 'minoanhobby@gmail.com';
const BREVO_TO_EMAIL = 'minoanhobby@gmail.com';

export default async function handler(req, res) {

    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    if (req.method !== 'POST') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed'
        });
    }

    try {

        const details = req.body || {};

        if (!BREVO_API_KEY) {
            throw new Error('BREVO_API_KEY is missing');
        }

        const brevoResponse = await fetch(
            'https://api.brevo.com/v3/smtp/email',
            {
                method: 'POST',

                headers: {
                    'Content-Type': 'application/json',
                    'api-key': BREVO_API_KEY
                },

                body: JSON.stringify({

                    sender: {
                        name: 'MinoanHobby',
                        email: BREVO_SENDER_EMAIL
                    },

                    to: [
                        {
                            email: BREVO_TO_EMAIL
                        }
                    ],

                    subject: '📝 Νέα Παραγγελία (Checkout)',

                    textContent:
                        'Ονομα: ' +
                        ((details.firstName || '') +
                        ' ' +
                        (details.lastName || '')) +
                        '\n\n' +

                        'Email: ' +
                        (details.email || '') +
                        '\n' +

                        'Τηλέφωνο: ' +
                        (details.phone || '') +
                        '\n' +

                        'Διεύθυνση: ' +
                        (details.address || '') +
                        '\n' +

                        'Πόλη: ' +
                        (details.city || '') +
                        '\n' +

                        'ΤΚ: ' +
                        (details.zip || '') +
                        '\n\n' +

                        'Είδος: ' +
                        (details.teamId ||
                         details.teamName ||
                         'Άγνωστο') +
                        '\n' +

                        'Ποσό: ' +
                        (details.amount ||
                         details.price ||
                         '0') +
                        ' €' +
                        '\n\n' +

                        'Καλάθι:\n' +
                        JSON.stringify(
                            details.cartDetails || '',
                            null,
                            2
                        )
                })
            }
        );

        const brevoData =
            await brevoResponse.json().catch(() => ({}));

        if (!brevoResponse.ok) {

            console.error(
                'BREVO ERROR:',
                brevoResponse.status,
                brevoData
            );

            return res.status(brevoResponse.status).json({
                success: false,
                error: brevoData
            });
        }

        console.log(
            'BREVO EMAIL SENT:',
            brevoData
        );

        return res.status(200).json({
            success: true,
            brevo: brevoData
        });

    } catch (error) {

        console.error(
            'BREVO CHECKOUT ERROR:',
            error
        );

        return res.status(500).json({
            success: false,
            error: error.message
        });
    }
}
