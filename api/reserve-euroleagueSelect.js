const express = require('express');
const router = express.Router();

// GET: Επιστρέφει την κατάσταση όλων των ομάδων
router.get('/reserve-euroleagueSelect', async (req, res) => {
    // Εδώ δεν χρειαζόμαστε πλέον map, απλά επιστρέφουμε ποιες είναι κλειδωμένες
    const keys = await redis.keys('team:lock:*');
    const lockedIds = keys.map(key => parseInt(key.split(':')[2]));
    res.json({ locked: lockedIds });
});

// POST: Διαχείριση κράτησης για συγκεκριμένη ομάδα
router.post('/reserve-euroleagueSelect', async (req, res) => {
    const { teamId, action } = req.body;

    if (action === 'add') {
        // 1. Ελέγχουμε αν έχει ήδη πουληθεί (μονιμοποιηθεί)
        const isSold = await redis.get(`team:sold:${teamId}`);
        if (isSold) return res.status(400).json({ error: "Η ομάδα έχει εξαντληθεί." });

        // 2. Προσπαθούμε να κλειδώσουμε ΜΟΝΟ αυτή την ομάδα (NX = Not Exists)
        // Το κλειδί είναι μοναδικό: team:lock:1, team:lock:2, κλπ.
        const locked = await redis.set(`team:lock:${teamId}`, 'locked', 'EX', 300, 'NX');
        
        if (!locked) return res.status(400).json({ error: "Η ομάδα δεσμεύτηκε μόλις τώρα." });
        
        return res.json({ success: true });
    }

    if (action === 'remove') {
        // Διαγράφουμε το lock της συγκεκριμένης ομάδας
        await redis.del(`team:lock:${teamId}`);
        return res.json({ success: true });
    }
});
