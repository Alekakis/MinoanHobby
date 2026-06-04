import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

const STOCK_KEY = 'SELECT:random-euroleague-box:stock';
const HOLD_PREFIX = 'SELECT:random-euroleague-box:hold';
const HOLD_COUNT_KEY = 'SELECT:random-euroleague-box:holdCount';
const SOLD_COUNT_KEY = 'SELECT:random-euroleague-box:soldCount';
const MAX_STOCK = 21;
const HOLD_TTL = 8 * 60 * 60; // 8 hours

function makeHoldKey(cartId) {
	return `${HOLD_PREFIX}:${cartId}`;
}

export default async function handler(req, res) {
	res.setHeader('Access-Control-Allow-Origin', '*');
	res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
	res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

	if (req.method === 'OPTIONS') return res.status(200).end();

	try {
		const exists = await redis.exists(STOCK_KEY);
		if (!exists) await redis.set(STOCK_KEY, MAX_STOCK);

		if (req.method === 'GET') {
			const [stock, holdCount, soldCount] = await redis.mget(STOCK_KEY, HOLD_COUNT_KEY, SOLD_COUNT_KEY);
			const keys = await redis.keys(`${HOLD_PREFIX}:*`);
			const p = redis.pipeline();
			keys.forEach(k => { p.get(k); p.ttl(k); });
			const results = await p.exec();
			const holds = [];
			for (let i = 0; i < keys.length; i++) {
				const value = (results[i * 2] && results[i * 2][1]) || null;
				const ttl = (results[i * 2 + 1] && results[i * 2 + 1][1]);
				holds.push({ key: keys[i], value, ttl });
			}

			return res.status(200).json({
				stock: Number(stock || 0),
				held: Number(holdCount || 0),
				sold: Number(soldCount || 0),
				holds
			});
		}

		if (req.method === 'POST') {
			let body = req.body;
			if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) {} }

			const { action, qty = 1, cartId } = body || {};

			if (!action) return res.status(400).json({ error: 'action required' });

			if (action === 'reserve') {
				const requested = parseInt(qty, 10) || 1;
				const id = cartId || `${Date.now()}-${Math.floor(Math.random() * 1000000)}`;
				const holdKey = makeHoldKey(id);

				const existing = await redis.get(holdKey);
				const currentStock = parseInt(await redis.get(STOCK_KEY) || '0', 10);
				if (currentStock < requested) return res.status(400).json({ error: 'no_stock' });

				const newStock = await redis.decrby(STOCK_KEY, requested);
				if (newStock < 0) {
					await redis.incrby(STOCK_KEY, requested);
					return res.status(400).json({ error: 'no_stock' });
				}

				if (existing) {
					const newQty = parseInt(existing || '0', 10) + requested;
					await redis.set(holdKey, String(newQty), 'EX', HOLD_TTL);
				} else {
					await redis.set(holdKey, String(requested), 'EX', HOLD_TTL);
				}

				await redis.incrby(HOLD_COUNT_KEY, requested);

				return res.status(200).json({ success: true, reserved: true, id, qty: requested, ttl: HOLD_TTL });
			}

			if (action === 'release') {
				if (cartId) {
					const holdKey = makeHoldKey(cartId);
					const val = await redis.get(holdKey);
					if (!val) return res.status(200).json({ success: true, released: false, reason: 'not_found' });
					const q = parseInt(val || '0', 10) || 0;
					await redis.del(holdKey);
					await redis.decrby(HOLD_COUNT_KEY, q);
					await redis.incrby(STOCK_KEY, q);
					return res.status(200).json({ success: true, released: true, qty: q });
				}

				const requested = parseInt(qty, 10) || 1;
				const holdCount = parseInt(await redis.get(HOLD_COUNT_KEY) || '0', 10);
				if (holdCount <= 0) return res.status(400).json({ error: 'no_held_items' });
				const toRelease = Math.min(requested, holdCount);
				await redis.decrby(HOLD_COUNT_KEY, toRelease);
				await redis.incrby(STOCK_KEY, toRelease);
				return res.status(200).json({ success: true, released: true, qty: toRelease });
			}

			if (action === 'confirm') {
				if (cartId) {
					const holdKey = makeHoldKey(cartId);
					const val = await redis.get(holdKey);
					if (!val) return res.status(200).json({ success: true, confirmed: false, reason: 'not_found' });
					const q = parseInt(val || '0', 10) || 0;
					await redis.del(holdKey);
					await redis.decrby(HOLD_COUNT_KEY, q);
					await redis.incrby(SOLD_COUNT_KEY, q);
					return res.status(200).json({ success: true, confirmed: true, qty: q });
				}

				const requested = parseInt(qty, 10) || 1;
				const holdCount = parseInt(await redis.get(HOLD_COUNT_KEY) || '0', 10);
				if (holdCount <= 0) return res.status(400).json({ error: 'no_held_items' });
				const toConfirm = Math.min(requested, holdCount);
				await redis.decrby(HOLD_COUNT_KEY, toConfirm);
				await redis.incrby(SOLD_COUNT_KEY, toConfirm);
				return res.status(200).json({ success: true, confirmed: true, qty: toConfirm });
			}

			return res.status(400).json({ error: 'invalid action' });
		}

		return res.status(405).json({ error: 'Method not allowed' });
	} catch (error) {
		return res.status(500).json({ error: error.message });
	}
}
