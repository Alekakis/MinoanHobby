import { kv } from '@vercel/kv';

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method not allowed' });
    }

    // Παίρνουμε το amount ΚΑΙ το teamId από το front-end
    const { amount, teamId } = req.body;

    try {
        if (!amount) throw new Error("Missing amount");
        if (!teamId) throw new Error("Missing teamId");

        // 1. ΕΛΕΓΧΟΣ ΣΤΗ ΒΑΣΗ (Vercel KV)
        const currentStatus = await kv.get(`team:status:${teamId}`);

        if (currentStatus === 'sold') {
            return res.status(400).json({ error: 'Το slot έχει ήδη εξαντληθεί!' });
        }
        if (currentStatus === 'pending') {
            return res.status(400).json({ error: 'Το slot είναι προσωρινά δεσμευμένο από άλλον αγοραστή!' });
        }

        // 2. ΠΡΟΣΩΡΙΝΟ ΚΛΕΙΔΩΜΑ ΓΙΑ 10 ΛΕΠΤΑ (600 δευτερόλεπτα)
        await kv.set(`team:status:${teamId}`, 'pending', { ex: 600 });

        // 3. ΕΠΙΚΟΙΝΩΝΙΑ ΜΕ VIVA WALLET (Ο δικός σου κώδικας)
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

        // Αν η Viva μας επιστρέψει κανονικά OrderCode, στέλνουμε τα δεδομένα στο front-end
        if (data.OrderCode) {
            return res.status(200).json(data);
        } else {
            // Αν η Viva αποτύχει για οποιονδήποτε λόγο, ξεκλειδώνουμε αμέσως την ομάδα στη βάση
            await kv.del(`team:status:${teamId}`);
            return res.status(400).json({ error: "Αποτυχία Viva Wallet", details: data });
        }

    } catch (error) {
        console.error("Vercel Function Error:", error);
        // Σε περίπτωση σφάλματος, προσπαθούμε να ξεκλειδώσουμε την ομάδα αν είχε προλάβει να κλειδώσει
        if (teamId) {
            try { await kv.del(`team:status:${teamId}`); } catch (_) {}
        }
        return res.status(500).json({ error: error.message });
    }
}
