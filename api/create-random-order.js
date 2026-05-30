import Redis from 'ioredis';
const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

export default async function handler(req, res) {
    if (req.method !== 'POST') return res.status(405).end();
    
    try {
        let available = [];
        for (let i = 1; i <= 23; i++) {
            const status = await redis.get(`team:status:${i}`);
            if (!status) available.push(i);
        }
        
        if (available.length === 0) return res.status(400).json({ error: 'Εξαντλήθηκε το Pool!' });
        
        const teamId = available[Math.floor(Math.random() * available.length)];
        await redis.set(`team:status:${teamId}`, 'pending', 'EX', 600);

        const auth = Buffer.from('db03347e-8d36-4139-83cd-d45449e2d44c:05dreaYv174ROJz6NHvqZ4RtO8JU5P').toString('base64');
        const vRes = await fetch('https://www.vivapayments.com/api/orders', {
            method: 'POST',
            headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ 'Amount': '2749', 'MerchantTrns': `megabox-${teamId}`, 'SourceCode': '4936' })
        });
        const data = await vRes.json();
        return res.status(200).json(data);
    } catch (e) { return res.status(500).json({ error: e.message }); }
}
