
import Redis from 'ioredis';

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
				access_key: process.env.WEB3FORMS_KEY,
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

		return res.status(200).json({ success: true });

	} catch (error) {
		console.error('send-order-web3 error:', error);
		return res.status(500).json({ error: error.message });
	}
}
