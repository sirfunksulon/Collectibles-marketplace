const POKEMON_API_URL = 'https://api.pokemontcg.io/v2/cards';

const pokemonTcgCache = new Map();

function escapePokemonTcgQuery(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .trim();
}

async function pokemonTcgRequest(query, pageSize = 250) {
  const cacheKey = `${query}|${pageSize}`;

  if (pokemonTcgCache.has(cacheKey)) {
    return pokemonTcgCache.get(cacheKey);
  }

  const url =
    `${POKEMON_API_URL}?q=${encodeURIComponent(query)}` +
    `&pageSize=${pageSize}`;

  let lastError;

  // Small retry protects against temporary API/network failures.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });

      if (!response.ok) {
        throw new Error(
          `Pokémon TCG API returned ${response.status}`
        );
      }

      const data = await response.json();
      const results = Array.isArray(data.data) ? data.data : [];

      pokemonTcgCache.set(cacheKey, results);

      return results;
    } catch (error) {
      lastError = error;

      if (attempt === 0) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }
  }

  throw lastError;
}

function variantNamesFromCard(card) {
  const prices = card?.tcgplayer?.prices || {};
  const names = [];

  const map = {
    normal: 'Normal',
    holofoil: 'Holo',
    reverseHolofoil: 'Reverse Holo',
    '1stEditionHolofoil': '1st Edition Holo',
    unlimitedHolofoil: 'Unlimited Holo'
  };

  Object.keys(prices).forEach(key => {
    if (map[key]) {
      names.push(map[key]);
    }
  });

  if (card?.rarity) {
    const rarity = String(card.rarity).toLowerCase();

    if (rarity.includes('illustration rare')) {
      names.push('Illustration Rare');
    }

    if (rarity.includes('special illustration rare')) {
      names.push('Special Illustration Rare');
    }

    if (rarity.includes('secret')) {
      names.push('Secret Rare');
    }

    if (rarity.includes('full art')) {
      names.push('Full Art');
    }
  }

  return [...new Set(names)];
}

// Existing compatibility function.
// RapidUp can continue calling fetchPokemonCard().
async function fetchPokemonCard(cardName) {
  const q = String(cardName ?? '').trim();

  if (!q) {
    return [];
  }

  return pokemonTcgRequest(
    `name:"${escapePokemonTcgQuery(q)}"`
  );
}

// Generic lookup used by the RapidUp Consignment Generator.
async function searchPokemonCards(criteria = {}) {
  const pokemon = String(criteria.pokemon ?? '').trim();
  const set = String(criteria.set ?? '').trim();
  const card = String(criteria.card ?? '').trim();
  const variant = String(criteria.variant ?? '').trim();

  let query = '';

  if (card) {
    const number = card.replace(/^#/, '').trim();

    if (/^\d+(?:\/\d+)?$/.test(number)) {
      query =
        `number:${escapePokemonTcgQuery(number.split('/')[0])}`;
    } else {
      query =
        `name:"${escapePokemonTcgQuery(card)}"`;
    }
  } else if (set) {
    query =
      `set.name:"${escapePokemonTcgQuery(set)}"`;
  } else if (pokemon) {
    query =
      `name:"${escapePokemonTcgQuery(pokemon)}"`;
  } else if (variant) {
    // Variant is not consistently searchable through the API,
    // so retrieve Pokémon cards and let RapidUp filter them.
    query = 'supertype:Pokémon';
  } else {
    return [];
  }

  return pokemonTcgRequest(query, 250);
}

function getPokemonCardVariants(card) {
  return variantNamesFromCard(card);
}
