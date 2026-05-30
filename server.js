// Παράδειγμα Server Logics για την επιλογή νικητή
app.post('/api/finalize-winner', async (req, res) => {
    const { slotId } = req.body;
    
    // 1. Ανάκτηση όλων των συμμετεχόντων από τη βάση δεδομένων
    const participants = await db.getParticipantsForSlot(slotId); 
    
    // 2. Έλεγχος ότι συμπληρώθηκαν όλοι οι διαιρέτες
    if (participants.length === 6) {
        // 3. Random επιλογή (αδιάβλητη)
        const winnerIndex = Math.floor(Math.random() * participants.length);
        const winner = participants[winnerIndex];
        
        // 4. Αποθήκευση νικητή στη βάση
        await db.saveWinner(slotId, winner);
        res.json({ success: true, winner: winner });
    } else {
        res.status(400).json({ error: "Δεν έχουν συμπληρωθεί ακόμα όλες οι θέσεις." });
    }
});
