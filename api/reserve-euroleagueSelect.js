import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        // --- GET: Επιστροφή κατάστασης όλων των ομάδων ---
        if (req.method === 'GET') {
            // Παίρνουμε το stock για όλες τις ομάδες από 1 έως 23
            let status = {};
            for (let i = 1; i <= 23; i++) {
                const stock = await redis.get(`team:stock:${i}`);
                status[i] = stock !== null ? parseInt(stock) : 1; // 1 είναι το αρχικό stock
            }
            return res.status(200).json({ stocks: status });
        }

        // --- POST: Αλλαγή στοκ για συγκεκριμένη ομάδα ---
        if (req.method === 'POST') {
            let body = req.body;
            if (typeof body === 'string') { try { body = JSON.parse(body); } catch(e) {} }
            const { teamId, action } = body || {};

            if (!teamId) return res.status(400).json({ error: 'Missing teamId' });

            const KEY = `team:stock:${teamId}`;
            
            // Αρχικοποίηση αν δεν υπάρχει (stock 1)
            const currentStock = parseInt(await redis.get(KEY)) ?? 1;

            if (action === 'add') {
                if (currentStock <= 0) return res.status(400).json({ error: 'Εξαντλήθηκε!' });
                await redis.decr(KEY); // Γίνεται 0
                return res.status(200).json({ success: true, stock: 0 });
            } 
            
            if (action === 'remove') {
                await redis.set(KEY, 1); // Επαναφορά στο 1
                return res.status(200).json({ success: true, stock: 1 });
            }

            return res.status(400).json({ error: 'Invalid action' });
        }

        return res.status(405).json({ error: 'Method not allowed' });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
