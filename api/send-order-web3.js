const BREVO_API_KEY = process.env.BREVO_API_KEY;
const BREVO_SENDER_EMAIL = 'minoanhobby@gmail.com';
const BREVO_TO_EMAIL = 'minoanhobby@gmail.com';


import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

// This endpoint forwards order details to Web3Forms using the server-side key
export default async function handler(req, res) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

	if (req.method === 'OPTIONS') return res.status(200).end();

	if (req.method !== 'POST') {
		return res.status(405).json({ error: 'Method not allowed' });
	}

	let body = req.body;
	if (typeof body === 'string') {
		try { body = JSON.parse(body); } catch (e) {}
	}

	try {
		const details = body || {};

		await fetch('https://api.web3forms.com/submit', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({
				access_key: "ef54407f-a593-41c3-8fce-209c5ebf6e97",
				subject: '📝 Νέα Παραγγελία (Checkout)',
				'Ονομα': (details.firstName || '') + ' ' + (details.lastName || ''),
				'Email': details.email || '',
				'Τηλέφωνο': details.phone || '',
				'Διεύθυνση': details.address || '',
				'Πόλη': details.city || '',
				'ΤΚ': details.zip || '',
				'Είδος': details.teamId || details.teamName || 'Άγνωστο',
				'Ποσό': (details.amount || details.price || '0') + ' €',
				'Καλάθι': JSON.stringify(details.cartDetails || '')
			})
		});

		try {
			if (!BREVO_API_KEY || !BREVO_SENDER_EMAIL || !BREVO_TO_EMAIL) {
				throw new Error('Missing BREVO_API_KEY, BREVO_SENDER_EMAIL or BREVO_TO_EMAIL');
			}

			const brevoResponse = await fetch('https://api.brevo.com/v3/smtp/email', {
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
						'Ονομα: ' + ((details.firstName || '') + ' ' + (details.lastName || '')) + '\n' +
						'Email: ' + (details.email || '') + '\n' +
						'Τηλέφωνο: ' + (details.phone || '') + '\n' +
						'Διεύθυνση: ' + (details.address || '') + '\n' +
						'Πόλη: ' + (details.city || '') + '\n' +
						'ΤΚ: ' + (details.zip || '') + '\n' +
						'Είδος: ' + (details.teamId || details.teamName || 'Άγνωστο') + '\n' +
						'Ποσό: ' + (details.amount || details.price || '0') + ' €' + '\n' +
						'Καλάθι: ' + JSON.stringify(details.cartDetails || '')
				})
			});

			if (!brevoResponse.ok) {
				const brevoError = await brevoResponse.text();
				throw new Error(`Brevo ${brevoResponse.status}: ${brevoError}`);
			}
		} catch (e) {
			console.error('Brevo notify failed (send-order-web3):', e);
		}

		return res.status(200).json({ success: true });

	} catch (error) {
		console.error('send-order-web3 error:', error);
		return res.status(500).json({ error: error.message });
	}
}
