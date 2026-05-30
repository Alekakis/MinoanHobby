export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { amount, teamId } = req.body;

    try {
        if (!amount) throw new Error("Missing amount");
        if (!teamId) throw new Error("Missing teamId");

        const kvUrl = process.env.KV_REST_API_URL;
        const kvToken = process.env.KV_REST_API_TOKEN;

        // 1. ΕΛΕΓΧΟΣ ΣΤΗ ΒΑΣΗ (Μέσω REST)
        const checkResponse = await fetch(`${kvUrl}/get/team:status:${teamId}`, {
            headers: { Authorization: `Bearer ${kvToken}` }
        });
        const checkData = await checkResponse.json();
        const currentStatus = checkData.result;

        if (currentStatus === 'sold') {
            return res.status(400).json({ error: 'Το slot έχει ήδη εξαντληθεί!' });
        }
        if (currentStatus === 'pending') {
            return res.status(400).json({ error: 'Το slot είναι προσωρινά δεσμευμένο!' });
        }

        // 2. ΚΛΕΙΔΩΜΑ ΓΙΑ 10 ΛΕΠΤΑ (600 δευτερόλεπτα)
        await fetch(`${kvUrl}/set/team:status:${teamId}/pending/EX/600`, {
            headers: { Authorization: `Bearer ${kvToken}` }
        });

        // 3. ΕΠΙΚΟΙΝΩΝΙΑ ΜΕ VIVA WALLET
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
            return res.status(200).json(data);
        } else {
            // Αν αποτύχει η Viva, ξεκλειδώνουμε
            await fetch(`${kvUrl}/del/team:status:${teamId}`, {
                headers: { Authorization: `Bearer ${kvToken}` }
            });
            return res.status(400).json({ error: "Αποτυχία Viva Wallet", details: data });
        }

    } catch (error) {
        console.error("Vercel Function Error:", error);
        if (teamId) {
            const kvUrl = process.env.KV_REST_API_URL;
            const kvToken = process.env.KV_REST_API_TOKEN;
            try { 
                await fetch(`${kvUrl}/del/team:status:${teamId}`, { headers: { Authorization: `Bearer ${kvToken}` } });
            } catch (_) {}
        }
        return res.status(500).json({ error: error.message });
    }
}
