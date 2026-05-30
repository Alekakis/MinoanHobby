export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        // Διαβάζουμε τα στοιχεία σύνδεσης της βάσης απευθείας από το Vercel
        const kvUrl = "https://admirable-prosperous-insurance-32661.upstash.io";
        const kvToken = "9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k";

        // Παίρνουμε όλα τα κλειδιά που ξεκινάνε με team:status:
        const keysResponse = await fetch(`${kvUrl}/keys/team:status:*`, {
            headers: { Authorization: `Bearer ${kvToken}` }
        });
        const keysData = await keysResponse.json();
        const keys = keysData.result || [];

        const slotStatuses = {};

        if (keys.length > 0) {
            // Παίρνουμε τις τιμές για αυτά τα κλειδιά
            const valuesResponse = await fetch(`${kvUrl}/mget`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${kvToken}` },
                body: JSON.stringify(keys)
            });
            const valuesData = await valuesResponse.json();
            const values = valuesData.result || [];

            keys.forEach((key, index) => {
                const teamId = key.split(':').pop();
                slotStatuses[teamId] = values[index];
            });
        }

        return res.status(200).json(slotStatuses);
    } catch (error) {
        console.error("Database error:", error);
        return res.status(500).json({ error: "Αποτυχία ανάκτησης από τη βάση." });
    }
}
