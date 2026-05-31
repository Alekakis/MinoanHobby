import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let event = req.body;
    if (typeof event === 'string') {
        try { event = JSON.parse(event); } catch(e) {}
    }

    if (event && event.KeyVerification) {
        return res.status(200).json({ KeyVerification: event.KeyVerification });
    }

    try {
        const eventData = event.EventData || {};
        const orderCode = eventData.OrderCode;
        const statusId = eventData.StatusId;
        const eventTypeId = event.EventTypeId;

        if (!orderCode) return res.status(200).json({ error: 'No order code' });

        // --- 1. ΕΠΙΤΥΧΗΣ ΠΛΗΡΩΜΗ (F) ---
        if (eventTypeId === 1796 || statusId === 'F') {
            const orderDetailsRaw = await redis.get(`viva:order:details:${orderCode}`);
            const details = orderDetailsRaw ? JSON.parse(orderDetailsRaw) : {};

            // Αποστολή στο Web3Forms
            await fetch('https://api.web3forms.com/submit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    access_key: "ef54407f-a593-41c3-8fce-209c5ebf6e97",
                    subject: "💰 Πληρωμένη Παραγγελία: " + (details.firstName || ""),
                    "Order Code": orderCode,
                    "Ονομα": (details.firstName || "") + " " + (details.lastName || ""),
                    "Είδος": details.teamName || "Άγνωστο",
                    "Ποσό": (details.price || "0") + " €"
                })
            });

            // Καθαρισμός όλων των pending keys
            await redis.del(`viva:pending:ducks:${orderCode}`, `viva:pending:megabox:${orderCode}`, `viva:pending:euroleague:${orderCode}`, `viva:pending:select:${orderCode}`, `viva:pending:laliga:${orderCode}`);
            
            // Οριστικοποίηση Euroleague Select
            const teamId = await redis.get(`viva:mapping:team:${orderCode}`);
            if (teamId && !isNaN(parseInt(teamId))) {
                await redis.set(`team:stock:${teamId}`, 0);
            }
            
            await redis.del(`viva:mapping:team:${orderCode}`, `viva:order:details:${orderCode}`);
            return res.status(200).json({ status: 'success' });
        }

        // --- 2. ΑΚΥΡΩΣΗ / ΑΠΟΤΥΧΙΑ (E, X, C) ---
        if (statusId === 'E' || statusId === 'X' || statusId === 'C') {
            const megaboxQty = await redis.get(`viva:pending:megabox:${orderCode}`);
            if (megaboxQty) await redis.incrby('product:stock:megabox', parseInt(megaboxQty));

            const ducksQty = await redis.get(`viva:pending:ducks:${orderCode}`);
            if (ducksQty) await redis.incrby('ducks', parseInt(ducksQty));

            const teamId = await redis.get(`viva:mapping:team:${orderCode}`);
            if (teamId && !isNaN(parseInt(teamId))) {
                await redis.set(`team:stock:${teamId}`, 1);
            }

            await redis.del(`viva:pending:ducks:${orderCode}`, `viva:pending:megabox:${orderCode}`, `viva:mapping:team:${orderCode}`, `viva:order:details:${orderCode}`);
            return res.status(200).json({ status: 'cancelled' });
        }

        return res.status(200).json({ status: 'received' });

    } catch (error) {
        console.error("Webhook Error:", error);
        return res.status(500).json({ error: error.message }); 
    }
}
