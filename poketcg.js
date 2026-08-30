// poketcg.js
const POKEMON_API_URL = 'https://api.pokemontcg.io/v2/cards';

async function fetchPokemonCard(cardName) {
  try {
    const response = await fetch(`${POKEMON_API_URL}?q=name:${encodeURIComponent(cardName)}`);
    const data = await response.json();
    return data.data;
  } catch (error) {
    console.error('Error fetching Pokémon TCG API data:', error);
    return [];
  }
}
