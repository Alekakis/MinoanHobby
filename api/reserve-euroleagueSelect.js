const express = require('express');
const router = express.Router();
// Υποθέτω ότι έχεις ήδη ορίσει το 'redis' client στο πάνω μέρος του αρχείου
// π.χ. const redis = new Redis(...);

// Χρόνος δέσμευσης σε δευτερόλεπτα (π.χ. 300 για 5 λεπτά)
const LOCK_DURATION = 300; 

// GET: Επιστρέφει την κατάσταση όλων των δεσμευμένων slots
router.get('/reserve-euroleague', async (req, res) => {
    try {
        // Παίρνουμε όλα τα keys που αφορούν locks
        const keys = await redis.keys('team:lock:*');
        // Εξάγουμε το ID της ομάδας από το κλειδί (π.χ. team:lock:1 -> 1)
        const lockedIds = keys.map(key => parseInt(key.split(':')[2]));
        
        res.json({ locked: lockedIds });
    } catch (error) {
        res.status(500).json({ error: "Σφάλμα ανάκτησης δεδομένων" });
    }
});

// POST: Διαχείριση κράτησης
router.post('/reserve-euroleague', async (req, res) => {
    const { teamId, action } = req.body;

    if (action === 'add') {
        // Ελέγχουμε πρώτα αν έχει πουληθεί οριστικά (προαιρετικό, αν αποθηκεύεις sold στο redis)
        const isSold = await redis.exists(`team:sold:${teamId}`);
        if (isSold) {
            return res.status(400).json({ error: "Η ομάδα έχει ήδη πουληθεί!" });
        }

        // SET με NX: επιτυγχάνει μόνο αν το κλειδί ΔΕΝ υπάρχει ήδη.
        // Εγγυάται ότι αν 2 άτομα πατήσουν μαζί, ο ένας θα πάρει false.
        const locked = await redis.set(`team:lock:${teamId}`, 'locked', 'EX', LOCK_DURATION, 'NX');
        
        if (!locked) {
            return res.status(400).json({ error: "Η ομάδα έχει ήδη δεσμευτεί από άλλον χρήστη." });
        }
        
        console.log(`Ομάδα ${teamId} δεσμεύτηκε προσωρινά.`);
        return res.json({ success: true });
    }

    if (action === 'remove') {
        // Απελευθέρωση της ομάδας (μόνο αν δεν έχει πουληθεί)
        await redis.del(`team:lock:${teamId}`);
        return res.json({ success: true });
    }

    res.status(400).json({ error: "Μη έγκυρη ενέργεια" });
});

module.exports = router;
