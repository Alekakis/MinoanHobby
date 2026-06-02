
import Redis from 'ioredis';

// Prefer environment REDIS_URL; fall back to existing connection string if not provided
const redis = new Redis(process.env.REDIS_URL || "redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

export default async function handler(req, res) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-secret');

	if (req.method === 'OPTIONS') return res.status(200).end();

	// Basic admin auth using header x-admin-secret against INTERNAL_API_SECRET env var
	const adminSecret = process.env.INTERNAL_API_SECRET || '';

	const provided = req.headers['x-admin-secret'] || req.headers['x-internal-secret'];

	if (!adminSecret || String(provided) !== String(adminSecret)) {
		return res.status(401).json({ error: 'Unauthorized' });
	}

	try {
		if (req.method === 'GET') {
			// query ?teamId=5
			const teamId = req.query && req.query.teamId ? String(req.query.teamId) : null;
			if (!teamId) {
				return res.status(400).json({ error: 'teamId query required' });
			}

			const sold = await redis.get(`team:sold:${teamId}`);
			const hold = await redis.get(`team:hold:${teamId}`);
			const ttl = hold ? await redis.ttl(`team:hold:${teamId}`) : -2;

			const state = sold ? 'sold' : (hold ? 'held' : 'available');

			return res.status(200).json({ teamId, state, sold, hold, holdTtl: ttl });
		}

		if (req.method === 'POST') {
			let body = req.body;
			if (typeof body === 'string') {
				try { body = JSON.parse(body); } catch(e) { body = {}; }
			}

			const { action, teamId, cartId, ttl } = body || {};
			if (!teamId) return res.status(400).json({ error: 'teamId required' });

			const tid = String(teamId);

			if (action === 'sell') {
				await redis.set(`team:sold:${tid}`, '1');
				await redis.del(`team:hold:${tid}`);
				return res.status(200).json({ success: true, teamId: tid, state: 'sold' });
			}

			if (action === 'unsell') {
				await redis.del(`team:sold:${tid}`);
				return res.status(200).json({ success: true, teamId: tid, state: 'available' });
			}

			if (action === 'hold') {
				const holdTtl = parseInt(ttl || 420, 10);
				const value = cartId || 'admin';
				// Use NX to avoid overwriting existing hold; return conflict if already held
				const result = await redis.set(`team:hold:${tid}`, value, 'EX', holdTtl, 'NX');
				if (result === 'OK') {
					return res.status(200).json({ success: true, teamId: tid, state: 'held', ttl: holdTtl, heldBy: value });
				}
				const current = await redis.get(`team:hold:${tid}`);
				const currentTtl = await redis.ttl(`team:hold:${tid}`);
				return res.status(409).json({ error: 'already_held', teamId: tid, heldBy: current, ttl: currentTtl });
			}

			if (action === 'release') {
				await redis.del(`team:hold:${tid}`);
				return res.status(200).json({ success: true, teamId: tid, released: true });
			}

			return res.status(400).json({ error: 'invalid action' });
		}

		return res.status(405).json({ error: 'Method not allowed' });
	} catch (error) {
		return res.status(500).json({ error: error.message });
	}
}
