import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    // --- GET METHOD: Επιστρέφει το Live Στοκ ---
    if (req.method === 'GET') {
        try {
            const exists = await redis.exists('product:stock:megabox');
            if (!exists) await redis.set('product:stock:megabox', 18);

            const currentStock = parseInt(await redis.get('product:stock:megabox')) || 0;
            return res.status(200).json({ stock: currentStock });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    // --- POST METHOD: Προσθήκη / Αφαίρεση από το καλάθι ---
    if (req.method === 'POST') {
        let body = req.body;
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch(e) {}
        }

        const { action } = body || {};

        try {
            const exists = await redis.exists('product:stock:megabox');
            if (!exists) await redis.set('product:stock:megabox', 16);

            const currentStock = parseInt(await redis.get('product:stock:megabox')) || 0;

            if (action === 'add') {
                if (currentStock <= 0) {
                    return res.status(400).json({ error: 'Το προϊόν Megabox εξαντλήθηκε!' });
                }
                const newStock = await redis.decr('product:stock:megabox');
                return res.status(200).json({ success: true, stock: newStock });
            } 
            
            if (action === 'remove') {
                const newStock = await redis.incr('product:stock:megabox');
                return res.status(200).json({ success: true, stock: newStock });
            }

            return res.status(400).json({ error: 'Invalid action' });
        } catch (error) {
            return res.status(500).json({ error: error.message });
        }
    }

    return res.status(405).json({ error: 'Method not allowed' });
}
