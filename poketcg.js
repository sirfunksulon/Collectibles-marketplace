// poketcg.js
const POKEMON_API_URL = 'https://api.pokemontcg.io/v2/cards';

// Client-side cache so repeated searches do not repeatedly hit the API.
const pokemonCardSearchCache = new Map();

async function fetchPokemonCard(cardName) {
  const query = String(cardName || '').trim();

  if (!query) return [];

  const cacheKey = query.toLowerCase();

  // Return cached results immediately when available.
  if (pokemonCardSearchCache.has(cacheKey)) {
    return pokemonCardSearchCache.get(cacheKey);
  }

  try {
    const response = await fetch(
      `${POKEMON_API_URL}?q=name:"${encodeURIComponent(query)}"&pageSize=250`
    );

    if (!response.ok) {
      throw new Error(`Pokémon TCG API returned ${response.status}`);
    }

    const data = await response.json();
    const results = Array.isArray(data.data) ? data.data : [];

    pokemonCardSearchCache.set(cacheKey, results);

    return results;
  } catch (error) {
    console.error('Error fetching Pokémon TCG API data:', error);
    return [];
  }
}
