import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // Αν δεν υπάρχει καθόλου το κλειδί, το αρχικοποιούμε σε 10
        const exists = await redis.exists('product:stock:ducks');
        if (!exists) {
            await redis.set('product:stock:ducks', 10);
        }

        const currentStock = parseInt(await redis.get('product:stock:ducks')) || 0;
        
        return res.status(200).json({ stock: currentStock });
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
