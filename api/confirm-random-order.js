import Redis from 'ioredis';
const redis = new Redis("redis://default:9j6w6SPasZTuekVEVPTnoVCXNDFrRN0k@admirable-prosperous-insurance-32661.db.redis.io:10020");

export default async function handler(req, res) {
    const { orderCode } = req.query;
    const auth = Buffer.from('db03347e-8d36-4139-83cd-d45449e2d44c:05dreaYv174ROJz6NHvqZ4RtO8JU5P').toString('base64');
    const vRes = await fetch(`https://www.vivapayments.com/api/orders/${orderCode}`, { headers: { 'Authorization': `Basic ${auth}` } });
    const data = await vRes.json();

    if (data.State === 3) {
        const teamId = data.MerchantTrns.replace('megabox-', '');
        await redis.set(`team:status:${teamId}`, 'sold');
        return res.status(200).json({ teamId });
    }
    return res.status(400).json({ error: "Δεν ολοκληρώθηκε" });
}
