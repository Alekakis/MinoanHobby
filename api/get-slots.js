import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    // Επιτρέπουμε CORS για να μπορεί να το διαβάζει η HTML σελίδα
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    try {
        // Διαβάζει όλα τα κλειδιά από τη Redis που ξεκινούν με team:status:
        const keys = await kv.keys('team:status:*');
        const slotStatuses = {};
        
        if (keys.length > 0) {
            const values = await kv.mget(...keys);
            keys.forEach((key, index) => {
                const teamId = key.split(':').pop();
                slotStatuses[teamId] = values[index]; // Επιστρέφει π.χ. { "14": "sold", "18": "pending" }
            });
        }

        return res.status(200).json(slotStatuses);
    } catch (error) {
        console.error("Database error:", error);
        return res.status(500).json({ error: "Αποτυχία ανάκτησης δεδομένων από τη βάση." });
    }
}
