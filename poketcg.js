const POKEMON_API_URL = 'https://api.pokemontcg.io/v2/cards';

async function fetchPokemonCard(cardName) {
  try {
    const query = `name:"${String(cardName).replace(/"/g, '\\"')}"`;

    const response = await fetch(
      `${POKEMON_API_URL}?q=${encodeURIComponent(query)}`
    );

    if (!response.ok) {
      throw new Error(`Pokémon TCG API returned ${response.status}`);
    }

    const data = await response.json();

    return Array.isArray(data.data) ? data.data : [];
  } catch (error) {
    console.error('Error fetching Pokémon TCG API data:', error);
    return [];
  }
}
