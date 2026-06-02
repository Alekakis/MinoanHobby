import Redis from 'ioredis';

// Σύνδεση με το κανονικό Redis URL σου
const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    
    if (req.method === 'OPTIONS') return res.status(200).end();

    try {
        const spots = [];
        // Διαβάζουμε τα status για τις 24 ομάδες (1 έως 24)
        for (let i = 1; i <= 24; i++) {
            const status = await redis.get(`team:status:${i}`);
            spots.push({
                id: i,
                status: status || 'available' // Αν δεν υπάρχει, είναι διαθέσιμο
            });
        }
        return res.status(200).json(spots);
    } catch (error) {
        console.error("Redis Error:", error);
        return res.status(500).json({ error: error.message });
    }
}
