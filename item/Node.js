// Συνάρτηση επιλογής νικητή ανάμεσα σε X άτομα
function selectWinner(participantsArray) {
    // participantsArray είναι μια λίστα με τα IDs ή τα ονόματα των συμμετεχόντων
    // π.χ. ["User1", "User2", "User3"]
    
    if (participantsArray.length < 2 || participantsArray.length > 6) {
        throw new Error("Ο αριθμός των συμμετεχόντων πρέπει να είναι από 2 έως 6.");
    }

    const randomIndex = Math.floor(Math.random() * participantsArray.length);
    return participantsArray[randomIndex];
}

// Παράδειγμα χρήσης κατά την ολοκλήρωση της αγοράς
app.post('/api/finalize-winner', async (req, res) => {
    const { slotId } = req.body;
    
    // 1. Παίρνεις τους συμμετέχοντες από τη βάση για το συγκεκριμένο slot
    const participants = await db.getParticipantsForSlot(slotId); 
    
    // 2. Επιλέγεις τον νικητή
    const winner = selectWinner(participants);
    
    // 3. Αποθηκεύεις τον νικητή στη βάση
    await db.saveWinner(slotId, winner);
    
    res.json({ success: true, winner: winner });
});
