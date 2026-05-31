// reserve-euroleagueSelect.js
const express = require('express');
const router = express.Router();

// Σε πραγματική εφαρμογή, αυτά θα βρίσκονται στη βάση δεδομένων ή στο Redis
// Το 'lockedTeams' αποθηκεύει το ID της ομάδας και τον χρόνο που κλειδώθηκε
let lockedTeams = new Map(); 

// Χρόνος δέσμευσης σε milliseconds (π.χ. 5 λεπτά)
const LOCK_DURATION = 300000; 

// GET: Επιστρέφει την κατάσταση όλων των slots
router.get('/reserve-euroleague', (req, res) => {
    // Καθαρισμός ληγμένων κρατήσεων
    const now = Date.now();
    for (let [teamId, timestamp] of lockedTeams) {
        if (now - timestamp > LOCK_DURATION) {
            lockedTeams.delete(teamId);
        }
    }

    res.json({
        locked: Array.from(lockedTeams.keys())
    });
});

// POST: Διαχείριση κράτησης ή ακύρωσης
router.post('/reserve-euroleague', (req, res) => {
    const { teamId, action } = req.body;

    if (action === 'add') {
        // Έλεγχος αν είναι ήδη δεσμευμένη
        if (lockedTeams.has(teamId)) {
            return res.status(400).json({ error: "Η ομάδα έχει ήδη δεσμευτεί από άλλον χρήστη." });
        }
        
        // Κλείδωμα της ομάδας
        lockedTeams.set(teamId, Date.now());
        console.log(`Ομάδα ${teamId} δεσμεύτηκε.`);
        return res.json({ success: true });
    }

    if (action === 'remove') {
        // Απελευθέρωση της ομάδας
        lockedTeams.delete(teamId);
        return res.json({ success: true });
    }

    res.status(400).json({ error: "Μη έγκυρη ενέργεια" });
});

module.exports = router;
