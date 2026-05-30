import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let body = req.body;
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch(e) {}
    }

    const { action } = body || {}; // action: 'add' ή 'remove'

    try {
        // Αρχικοποίηση αν δεν υπάρχει
        const exists = await redis.exists('product:stock:ducks');
        if (!exists) await redis.set('product:stock:ducks', 10);

        const currentStock = parseInt(await redis.get('product:stock:ducks')) || 0;

        if (action === 'add') {
            if (currentStock <= 0) {
                return res.status(400).json({ error: 'Το προϊόν Ducks εξαντλήθηκε!' });
            }
            // Μείωση κατά 1 στο Redis
            const newStock = await redis.decr('product:stock:ducks');
            return res.status(200).json({ success: true, stock: newStock });
        } 
        
        if (action === 'remove') {
            // Επιστροφή 1 κομματιού αν ο χρήστης το βγάλει από το καλάθι ή λήξει ο χρόνος
            const newStock = await redis.incr('product:stock:ducks');
            return res.status(200).json({ success: true, stock: newStock });
        }

        return res.status(400).json({ error: 'Invalid action' });

    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
