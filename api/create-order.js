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
    
    const { amount, teamId, qty } = body || {};
    const orderQty = qty ? parseInt(qty) : 1;

    try {
        if (!amount) throw new Error("Missing amount");
        if (!teamId) throw new Error("Missing teamId");

        // --- ΕΙΔΙΚΗ ΛΟΓΙΚΗ ΓΙΑ ΤΙΣ ΠΑΠΙΕΣ (DUCKS) ---
        if (teamId.toLowerCase() === 'ducks') {
            // 1. Αρχικοποίηση stock στο Redis αν δεν υπάρχει (ξεκινάει από 10)
            const exists = await redis.exists('product:stock:ducks');
            if (!exists) {
                await redis.set('product:stock:ducks', 10);
            }

            // 2. Έλεγχος live stock
            const currentStock = parseInt(await redis.get('product:stock:ducks')) || 0;

            if (currentStock <= 0) {
                return res.status(400).json({ error: 'Το προϊόν Ducks έχει εξαντληθεί!' });
            }
            if (currentStock < orderQty) {
                return res.status(400).json({ error: `Δεν υπάρχει αρκετό απόθεμα. Διαθέσιμα κομμάτια: ${currentStock}` });
            }

            // 3. Προσωρινή μείωση stock για 2 λεπτά (120 δευτερόλεπτα)
            await redis.decrby('product:stock:ducks', orderQty);
            
        } else {
            // --- Η ΥΠΑΡΧΟΥΣΑ ΛΟΓΙΚΗ ΣΟΥ ΓΙΑ ΤΑ ΥΠΟΛΟΙΠΑ SLOTS ---
            const currentStatus = await redis.get(`team:status:${teamId}`);

            if (currentStatus === 'sold') {
                return res.status(400).json({ error: 'Το slot έχει ήδη εξαντληθεί!' });
            }
            if (currentStatus === 'pending') {
                return res.status(400).json({ error: 'Το slot είναι προσωρινά δεσμευμένο!' });
            }

            // Κλείδωμα για 2 λεπτά
            await redis.set(`team:status:${teamId}`, 'pending', 'EX', 120);
        }

        // 4. ΕΠΙΚΟΙΝΩΝΙΑ ΜΕ VIVA WALLET
        const merchantId = 'db03347e-8d36-4139-83cd-d45449e2d44c';
        const apiKey = '05dreaYv174ROJz6NHvqZ4RtO8JU5P';
        
        const amountCents = Math.round(parseFloat(amount) * 100).toString();
        const auth = Buffer.from(`${merchantId}:${apiKey}`).toString('base64');

        const vivaResponse = await fetch('https://www.vivapayments.com/api/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                'Amount': amountCents,
                'CustomerTrns': 'Order from Minoan Hobby',
                'RequestLang': 'el-GR',
                'MaxVisits': '1',
                'SourceCode': '4936'
            })
        });

        const data = await vivaResponse.json();

        if (data.OrderCode) {
            // Δημιουργία mappings για το Webhook ώστε να ξέρει τι να διαχειριστεί στην ακύρωση/επιτυχία
            if (teamId.toLowerCase() === 'ducks') {
                await redis.set(`viva:pending:ducks:${data.OrderCode}`, orderQty, 'EX', 120);
            } else {
                // Κρατάμε ποιο teamId αντιστοιχεί σε αυτό το OrderCode
                await redis.set(`viva:mapping:team:${data.OrderCode}`, teamId, 'EX', 120);
            }
            
            return res.status(200).json(data);
        } else {
            // Αποτυχία Viva Wallet -> Επαναφορά/Ξεκλείδωμα αμέσως
            if (teamId.toLowerCase() === 'ducks') {
                await redis.incrby('product:stock:ducks', orderQty);
            } else {
                await redis.del(`team:status:${teamId}`);
            }
            return res.status(400).json({ error: "Αποτυχία Viva Wallet", details: data });
        }

    } catch (error) {
        console.error("Vercel Function Error:", error);
        // Επαναφορά σε περίπτωση κρασαρίσματος του κώδικα
        if (teamId) {
            try {
                if (teamId.toLowerCase() === 'ducks') {
                    await redis.incrby('product:stock:ducks', orderQty);
                } else {
                    await redis.del(`team:status:${teamId}`);
                }
            } catch (_) {}
        }
        return res.status(500).json({ error: error.message });
    }
}
