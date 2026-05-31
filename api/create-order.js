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

        // --- ΛΟΓΙΚΗ ΓΙΑ ΤΑ ΥΠΟΛΟΙΠΑ ΚΑΝΟΝΙΚΑ SLOTS ---
        if (teamId.toLowerCase() !== 'ducks' && 
            teamId.toLowerCase() !== 'megabox half case' && 
            teamId.toLowerCase() !== '2025-26 panini euroleague contenders basketball mega box' &&
            teamId.toLowerCase() !== 'panini euroleague select box' &&
            teamId.toLowerCase() !== 'panini la liga select box') {
            
            const currentStatus = await redis.get(`team:status:${teamId}`);
            if (currentStatus === 'sold') return res.status(400).json({ error: 'Το slot έχει ήδη εξαντληθεί!' });
            if (currentStatus === 'pending') return res.status(400).json({ error: 'Το slot είναι προσωρινά δεσμευμένο!' });
            
            await redis.set(`team:status:${teamId}`, 'pending', 'EX', 120);
        }

        // --- ΕΠΙΚΟΙΝΩΝΙΑ ΜΕ VIVA WALLET ---
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

        // Εδώ ήταν το πρόβλημα - τα άγκιστρα ήταν λάθος
        if (data.OrderCode) {
            if (teamId.toLowerCase() === 'ducks') {
                await redis.set(`viva:pending:ducks:${data.OrderCode}`, orderQty, 'EX', 120);
            } else if (teamId.toLowerCase() === 'megabox half case') {
                await redis.set(`viva:pending:megabox:${data.OrderCode}`, orderQty, 'EX', 120);
            } else if (teamId.toLowerCase() === '2025-26 panini euroleague contenders basketball mega box') {
                await redis.set(`viva:pending:euroleague:${data.OrderCode}`, orderQty, 'EX', 120);
            } else if (teamId.toLowerCase() === 'panini euroleague select box') {
                await redis.set(`viva:pending:select:${data.OrderCode}`, orderQty, 'EX', 120);
            } else if (teamId.toLowerCase() === 'panini la liga select box') {
                await redis.set(`viva:pending:laliga:${data.OrderCode}`, orderQty, 'EX', 120);
            } else {
                await redis.set(`viva:mapping:team:${data.OrderCode}`, teamId, 'EX', 120);
            }
            return res.status(200).json(data);
        } else {
            // Αποτυχία Viva Wallet
            if (teamId.toLowerCase() !== 'ducks') {
                await redis.del(`team:status:${teamId}`);
            }
            // Κρατάω τα δεδομένα καθε πελάτη για το wed3form
            const customerData = {
                teamName: teamId,
                price: amount
            };
            // Αποθηκεύουμε τα στοιχεία για 1 ώρα στο Redis με το OrderCode που πήραμε από τη Viva
            await redis.set(`viva:order:details:${data.OrderCode}`, JSON.stringify(customerData), 'EX', 3600);
            return res.status(400).json({ error: "Αποτυχία Viva Wallet", details: data });
        }

    } catch (error) {
        console.error("Vercel Function Error:", error);
        
        // Επαναφορά σε περίπτωση κρασαρίσματος
        if (teamId && teamId.toLowerCase() !== 'ducks') {
            try {
                await redis.del(`team:status:${teamId}`);
            } catch (_) {}
        }
        return res.status(500).json({ error: error.message });
    }
}
