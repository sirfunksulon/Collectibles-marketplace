// api/consignment.js
// Basic Serebii set lookup engine
const SET_DATABASE = {
  "base-set": {
    id: "base-set",
    name: "Base Set",
    releaseYear: 1999,
    cards: [
      { id: "bs-1", pokemon: "Alakazam", name: "Alakazam", number: "1/102", variants: ["1st Edition Holo", "Unlimited Holo"] },
      { id: "bs-4", pokemon: "Charizard", name: "Charizard", number: "4/102", variants: ["1st Edition Holo", "Shadowless", "Unlimited Holo"] },
      { id: "bs-15", pokemon: "Venusaur", name: "Venusaur", number: "15/102", variants: ["1st Edition Holo", "Unlimited Holo"] }
    ]
  },
  "jungle": {
    id: "jungle",
    name: "Jungle",
    releaseYear: 1999,
    cards: [
      { id: "jng-1", pokemon: "Clefable", name: "Clefable", number: "1/64", variants: ["1st Edition Holo", "Unlimited Holo"] },
      { id: "jng-4", pokemon: "Jolteon", name: "Jolteon", number: "4/64", variants: ["1st Edition Holo", "Unlimited Holo"] },
      { id: "jng-13", pokemon: "Venomoth", name: "Venomoth", number: "13/64", variants: ["1st Edition Holo", "Unlimited Holo"] }
    ]
  }
};

export default function handler(req, res) {
  const { action, setId, pokemon } = req.query;

  // 1. Return all available sets
  if (action === 'getSets') {
    const sets = Object.values(SET_DATABASE).map(s => ({ id: s.id, name: s.name }));
    return res.status(200).json(sets);
  }

  // 2. Return cards filtered by selected set
  if (action === 'getCardsBySet' && setId) {
    const set = SET_DATABASE[setId];
    return res.status(200).json(set ? set.cards : []);
  }

  // 3. Process Consignment Submission
  if (req.method === 'POST') {
    const body = req.body;
    const title = `${body.cardName} #${body.cardNumber} ${body.setName} [${body.variant}]`;
    
    return res.status(200).json({
      success: true,
      consignmentId: `CSG-${Date.now()}`,
      title: title,
      routingKey: `${body.era}_${body.condition}_Auction`
    });
  }

  return res.status(400).json({ error: "Invalid action request" });
}
