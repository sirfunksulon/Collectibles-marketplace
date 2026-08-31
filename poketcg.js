// poketcg.js - Pokémon TCG API Client & In-Memory Indexer
const POKEMON_API_URL = 'https://api.pokemontcg.io/v2/cards';
const pokemonCardSearchCache = new Map();
const pokemonCardMemory = new Map();

function escapePokemonQuery(value) {
  return String(value || '').trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function uniqueCards(cards) {
  return [...new Map((cards || []).filter(Boolean).map(card => [card.id, card])).values()];
}

function cardMatchesText(card, value) {
  const q = String(value || '').trim().toLowerCase();
  if (!q) return true;
  const haystack = [card?.name, card?.number, card?.set?.name, card?.set?.id, ...(card?.types || []), ...(card?.subtypes || [])]
    .filter(Boolean).join(' ').toLowerCase();
  return haystack.includes(q);
}

async function pokemonTcgRequest(query, page = 1) {
  const normalizedQuery = String(query || '').trim();
  if (!normalizedQuery) return [];
  const key = `${normalizedQuery.toLowerCase()}|page:${page}`;
  if (pokemonCardSearchCache.has(key)) return pokemonCardSearchCache.get(key);

  const url = `${POKEMON_API_URL}?q=${encodeURIComponent(normalizedQuery)}&page=${page}&pageSize=250`;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Pokémon TCG API returned ${response.status}`);

  const result = await response.json();
  const cards = Array.isArray(result.data) ? result.data : [];
  pokemonCardSearchCache.set(key, cards);
  cards.forEach(card => { if (card?.id) pokemonCardMemory.set(card.id, card); });
  return cards;
}

function getPokemonCardVariants(card) {
  const variants = new Set();
  const prices = card?.tcgplayer?.prices || {};
  Object.keys(prices).forEach(key => {
    const k = key.toLowerCase();
    if (k.includes('reverseholo')) variants.add('Reverse Holo');
    if (k.includes('holofoil')) variants.add('Holo');
    if (k.includes('1stedition')) variants.add('1st Edition');
    if (k === 'normal') variants.add('Normal');
  });
  if (!variants.size) variants.add('Normal');
  return [...variants];
}

function cardHasVariant(card, variant) {
  if (!variant) return true;
  const wanted = String(variant).trim().toLowerCase();
  return getPokemonCardVariants(card).some(v => v.toLowerCase() === wanted);
}

// Streamlined Search: Direct API Query + Prefix Matching
async function searchByPokemon(value) {
  const searchValue = String(value || '').trim().toLowerCase();
  if (!searchValue) return [];

  try {
    const apiCards = await pokemonTcgRequest(`name:${searchValue}*`, 1);
    const allCards = uniqueCards([...pokemonCardMemory.values(), ...apiCards]);
    
    return allCards.filter(card => 
      String(card?.name || '').trim().toLowerCase().startsWith(searchValue)
    );
  } catch (error) {
    console.error('Direct Pokémon lookup failed, attempting local cache fallback:', error);
    const localCards = [...pokemonCardMemory.values()];
    const filtered = localCards.filter(card => 
      String(card?.name || '').trim().toLowerCase().startsWith(searchValue)
    );
    
    if (filtered.length > 0) return filtered;
    throw error;
  }
}

async function searchBySet(value) {
  const searchValue = String(value || '').trim().toLowerCase();
  if (!searchValue) return [];

  try {
    const apiCards = await pokemonTcgRequest(`set.name:"*${searchValue}*"`, 1);
    const allCards = uniqueCards([...pokemonCardMemory.values(), ...apiCards]);
    return allCards.filter(card => String(card?.set?.name || '').toLowerCase().includes(searchValue));
  } catch (error) {
    console.error('Set lookup failed:', error);
    return uniqueCards([...pokemonCardMemory.values()].filter(card => String(card?.set?.name || '').toLowerCase().includes(searchValue)));
  }
}

async function searchByCard(value) {
  const q = String(value || '').trim();
  if (!q) return [];
  const clean = q.replace(/^#/, '');
  const numberMatch = clean.match(/^(\d+)(?:\/\d+)?$/);

  if (numberMatch) {
    const number = numberMatch[1];
    try {
      const apiResults = await pokemonTcgRequest(`number:${number}`, 1);
      return uniqueCards([...apiResults, ...pokemonCardMemory.values()]).filter(card => String(card?.number || '').split('/')[0] === number);
    } catch (error) {
      console.error('Card number lookup failed:', error);
      return uniqueCards([...pokemonCardMemory.values()].filter(card => String(card?.number || '').split('/')[0] === number));
    }
  }

  const embeddedNumber = clean.match(/#?(\d+)(?:\/\d+)?$/);
  let namePart = embeddedNumber ? clean.slice(0, embeddedNumber.index).trim() : clean;

  try {
    const apiCards = namePart ? await pokemonTcgRequest(`name:"*${namePart}*"`, 1) : [];
    let results = uniqueCards([...apiCards, ...pokemonCardMemory.values()]).filter(card => 
      !namePart || String(card?.name || '').toLowerCase().includes(namePart.toLowerCase())
    );
    if (embeddedNumber) {
      const number = embeddedNumber[1];
      results = results.filter(card => String(card?.number || '').split('/')[0] === number);
    }
    return uniqueCards(results);
  } catch (error) {
    console.error('Card lookup failed:', error);
    return [];
  }
}

async function searchByVariant(value) {
  const q = String(value || '').trim().toLowerCase();
  if (!q) return [...pokemonCardMemory.values()];
  return uniqueCards([...pokemonCardMemory.values()].filter(card => getPokemonCardVariants(card).some(v => v.toLowerCase().includes(q))));
}

async function searchPokemonCards(search) {
  if (typeof search === 'string') {
    const value = search.trim();
    return value ? searchByPokemon(value) : [];
  }

  const criteria = search || {};
  const pokemon = String(criteria.pokemon || '').trim();
  const set = String(criteria.set || '').trim();
  const card = String(criteria.card || '').trim();
  const variant = String(criteria.variant || '').trim();

  let results = null;
  if (pokemon) results = await searchByPokemon(pokemon);
  if (set) {
    const setResults = await searchBySet(set);
    results = results === null ? setResults : results.filter(r => setResults.some(o => o.id === r.id));
  }
  if (card) {
    const cardResults = await searchByCard(card);
    results = results === null ? cardResults : results.filter(r => cardResults.some(o => o.id === r.id));
  }
  if (results === null) results = [...pokemonCardMemory.values()];
  if (variant) results = results.filter(r => cardHasVariant(r, variant));

  return uniqueCards(results);
}

async function fetchPokemonCard(cardName) {
  const query = String(cardName || '').trim();
  if (!query) return [];
  try {
    return await searchPokemonCards(query);
  } catch (error) {
    console.error('Error fetching Pokémon TCG API data:', error);
    throw error;
  }
}

function getPokemonNames(cards) {
  return [...new Set((cards || []).map(card => card?.name).filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function getPokemonSets(cards) {
  return [...new Map((cards || []).filter(card => card?.set?.id).map(card => [card.set.id, card.set.name])).values()].sort((a, b) => a.localeCompare(b));
}

function getPokemonCardOptions(cards) {
  return uniqueCards(cards || []).sort((a, b) => {
    const setCompare = (a?.set?.name || '').localeCompare(b?.set?.name || '');
    if (setCompare !== 0) return setCompare;
    return (a?.number || '').localeCompare(b?.number || '', undefined, { numeric: true });
  });
}

function getPokemonVariants(cards) {
  const variants = new Set();
  (cards || []).forEach(card => getPokemonCardVariants(card).forEach(v => variants.add(v)));
  return [...variants].sort((a, b) => a.localeCompare(b));
}

function filterPokemonCards(cards, criteria) {
  const source = Array.isArray(cards) ? cards : [];
  const pokemon = String(criteria?.pokemon || '').trim().toLowerCase();
  const set = String(criteria?.set || '').trim().toLowerCase();
  const card = String(criteria?.card || '').trim();
  const variant = String(criteria?.variant || '').trim();

  return source.filter(record => {
    if (pokemon && !String(record?.name || '').trim().toLowerCase().startsWith(pokemon)) return false;
    if (set && !String(record?.set?.name || '').toLowerCase().includes(set)) return false;
    if (card) {
      const cardText = [record?.name, record?.number].filter(Boolean).join(' ').toLowerCase();
      if (!cardText.includes(card.toLowerCase())) return false;
    }
    if (variant && !cardHasVariant(record, variant)) return false;
    return true;
  });
}

function clearPokemonTcgCache() {
  pokemonCardSearchCache.clear();
  pokemonCardMemory.clear();
}

// Global Exposure
window.searchPokemonCards = searchPokemonCards;
window.fetchPokemonCard = fetchPokemonCard;
window.getPokemonCardVariants = getPokemonCardVariants;
window.getPokemonNames = getPokemonNames;
window.getPokemonSets = getPokemonSets;
window.getPokemonCardOptions = getPokemonCardOptions;
window.getPokemonVariants = getPokemonVariants;
window.filterPokemonCards = filterPokemonCards;
window.clearPokemonTcgCache = clearPokemonTcgCache;
