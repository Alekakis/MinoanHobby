import Redis from 'ioredis';

const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

// Ορισμός του Pool των ομάδων (π.χ. 32 ομάδες NBA)
const TOTAL_TEAMS = 32; 

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    let body = req.body || {};
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch(e) {}
    }
    
    let { amount } = body;

    try {
        // ==========================================
        // ΦΑΣΗ 2: ΕΔΩ ΘΑ ΜΠΕΙ Ο ΥΠΟΛΟΓΙΣΜΟΣ ΤΩΝ ΔΙΑΙΡΕΤΩΝ
        // Π.χ. amount = (50.00 / dividers).toFixed(2);
        // ==========================================

        if (!amount) throw new Error("Missing amount");

        // 1. Εύρεση όλων των διαθέσιμων ομάδων στο Pool
        let availableTeams = [];
        for (let i = 1; i <= TOTAL_TEAMS; i++) {
            const status = await redis.get(`team:status:${i}`);
            if (status !== 'sold' && status !== 'pending') {
                availableTeams.push(i);
            }
        }

        // Αν δεν υπάρχει καμία ομάδα, το προϊόν εξαντλήθηκε
        if (availableTeams.length === 0) {
            return res.status(400).json({ error: 'Το Pool εξαντλήθηκε! Όλα τα slots πουλήθηκαν.' });
        }

        // 2. Επιλογή μιας τυχαίας ομάδας από τις διαθέσιμες
        const randomIndex = Math.floor(Math.random() * availableTeams.length);
        const chosenTeamId = availableTeams[randomIndex];

        // ==========================================
        // ΦΑΣΗ 2: ΕΔΩ ΘΑ ΜΠΕΙ Η ΛΟΓΙΚΗ ΤΩΝ SPOTS (ΔΙΑΙΡΕΤΕΣ)
        // Αντί για ολόκληρη ομάδα, θα δεσμεύεται ένα "Spot" της ομάδας.
        // ==========================================

        // 3. Προσωρινό κλείδωμα της ομάδας για 5 λεπτά
        await redis.set(`megabox:status:${chosenTeamId}`, 'pending', 'EX', 300);

        // 4. Δημιουργία Viva Order
        const merchantId = 'db03347e-8d36-4139-83cd-d45449e2d44c';
        const apiKey = '05dreaYv174ROJz6NHvqZ4RtO8JU5P';
        const amountCents = Math.round(parseFloat(amount) * 100).toString();
        const auth = Buffer.from(`${merchantId}:${apiKey}`).toString('base64');

        // Σημειώνουμε στο MerchantTrns ποια ομάδα αφορά η πληρωμή για να τη βρούμε στο success
        const merchantTrns = `megabox-team-${chosenTeamId}`;

        const vivaResponse = await fetch('https://www.vivapayments.com/api/orders', {
            method: 'POST',
            headers: {
                'Authorization': `Basic ${auth}`,
                'Content-Type': 'application/x-www-form-urlencoded'
            },
            body: new URLSearchParams({
                'Amount': amountCents,
                'CustomerTrns': 'Megabox Random Team Break',
                'RequestLang': 'el-GR',
                'MaxVisits': '1',
                'SourceCode': '4936',
                'MerchantTrns': merchantTrns // Κρίσιμο για την επιστροφή
            })
        });

        const data = await vivaResponse.json();

        if (data.OrderCode) {
            return res.status(200).json(data);
        } else {
            // Αν αποτύχει η Viva, ξεκλειδώνουμε την ομάδα
            await redis.del(`megabox:status:${chosenTeamId}`);
            return res.status(400).json({ error: "Αποτυχία Viva Wallet", details: data });
        }

    } catch (error) {
        console.error(error);
        return res.status(500).json({ error: error.message });
    }
}
