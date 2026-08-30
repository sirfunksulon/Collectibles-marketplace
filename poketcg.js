// poketcg.js

const POKEMON_API_URL = 'https://api.pokemontcg.io/v2/cards';

async function fetchPokemonCard(cardName) {
  const query = String(cardName || '').trim();

  if (!query) {
    return [];
  }

  try {
    const url = `${POKEMON_API_URL}?q=name:"${encodeURIComponent(query)}"&pageSize=250`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json'
      }
    });

    if (!response.ok) {
      throw new Error(`Pokémon TCG API returned ${response.status}`);
    }

    const result = await response.json();

    return Array.isArray(result.data) ? result.data : [];

  } catch (error) {
    console.error('Error fetching Pokémon TCG API data:', error);
    throw error;
  }
}
