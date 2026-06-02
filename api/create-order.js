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
    
    const { amount, teamId, qty, firstName, lastName, email, phone, address, city, zip } = body || {};
    const orderQty = qty ? parseInt(qty) : 1;
    const lowerTeamId = String(teamId).toLowerCase();

    try {
        if (!amount || !teamId) throw new Error("Missing required fields");

        // --- 1. ΛΟΓΙΚΗ STOCK ---
        if (!['ducks', 'megabox half case', '2025-26 panini euroleague contenders basketball mega box', 'panini euroleague select box', 'panini la liga select box'].includes(teamId.toLowerCase())) {
            const currentStatus = await redis.get(`team:status:${teamId}`);
            if (currentStatus === 'sold') return res.status(400).json({ error: 'Το slot έχει εξαντληθεί!' });
            if (currentStatus === 'pending') return res.status(400).json({ error: 'Το slot είναι δεσμευμένο!' });
            await redis.set(`team:status:${teamId}`, 'pending', 'EX', 120);
        }

        // --- 2. VIVA WALLET ---
        const auth = Buffer.from('db03347e-8d36-4139-83cd-d45449e2d44c:05dreaYv174ROJz6NHvqZ4RtO8SU5P').toString('base64');
        const vivaResponse = await fetch('https://www.vivapayments.com/api/orders', {
            method: 'POST',
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                'Amount': Math.round(parseFloat(amount) * 100).toString(),
                'CustomerTrns': 'Minoan Hobby Order',
                'SourceCode': '4936'
            })
        });

        const data = await vivaResponse.json();

        if (data.OrderCode) {
            // --- 3. ΑΠΟΘΗΚΕΥΣΗ ΣΤΟΙΧΕΙΩΝ ΓΙΑ ΤΟ WEBHOOK ---
            const customerData = { firstName, lastName, email, phone, address, city, zip, teamName: teamId, price: amount };
            await redis.set(`viva:order:details:${data.OrderCode}`, JSON.stringify(customerData), 'EX', 3600);
            
            // Mapping για το Webhook
            const lowerTeamId = String(teamId).toLowerCase();
            if (lowerTeamId === 'ducks') await redis.set(`viva:pending:ducks:${data.OrderCode}`, orderQty, 'EX', 120);
            else if (lowerTeamId === 'megabox half case') await redis.set(`viva:pending:megabox:${data.OrderCode}`, orderQty, 'EX', 120);
            else if (lowerTeamId.includes('euroleague contenders')) await redis.set(`viva:pending:euroleague:${data.OrderCode}`, orderQty, 'EX', 120);
            else if (lowerTeamId.includes('euroleague select')) {
                await redis.set(
                    `viva:pending:select:${data.OrderCode}`,
                    orderQty,
                    'EX',
                    120
                );
            }
            else if (lowerTeamId.includes('la liga')) await redis.set(`viva:pending:laliga:${data.OrderCode}`, orderQty, 'EX', 120);
            else await redis.set(`viva:mapping:team:${data.OrderCode}`, teamId, 'EX', 3600);

            return res.status(200).json(data);
        } else {
            throw new Error("Viva Wallet connection failed");
        }
    } catch (error) {
        return res.status(500).json({ error: error.message });
    }
}
