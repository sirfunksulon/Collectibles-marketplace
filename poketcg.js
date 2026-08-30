const POKEMON_API_URL = 'https://api.pokemontcg.io/v2/cards';

async function pokemonTcgRequest(query, pageSize = 250) {
  const url = `${POKEMON_API_URL}?q=${encodeURIComponent(query)}&pageSize=${pageSize}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Pokémon TCG API returned ${response.status}`);
  }

  const data = await response.json();
  return Array.isArray(data.data) ? data.data : [];
}

function escapePokemonTcgQuery(value) {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .trim();
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

// Public compatibility helper used by RapidUp.
// A card-name search remains the default behavior.
async function fetchPokemonCard(cardName) {
  const q = String(cardName ?? '').trim();

  if (!q) {
    return [];
  }

  try {
    return await pokemonTcgRequest(
      `name:"${escapePokemonTcgQuery(q)}"`
    );
  } catch (error) {
    console.error(
      'Error fetching Pokémon TCG API data:',
      error
    );

    return [];
  }
}

// Generic lookup used by the RapidUp Consignment Inventory Generator.
// The HTML combines and refines the returned records.
async function searchPokemonCards(criteria = {}) {
  const pokemon = String(criteria.pokemon ?? '').trim();
  const set = String(criteria.set ?? '').trim();
  const card = String(criteria.card ?? '').trim();
  const variant = String(criteria.variant ?? '').trim();

  let query = '';

  // Use the most structurally specific field as the API lookup anchor.
  // RapidUp applies the remaining populated fields after the records return.

  if (card) {
    const number = card.replace(/^#/, '').trim();

    if (/^\d+(?:\/\d+)?$/.test(number)) {
      query =
        `number:${escapePokemonTcgQuery(number.split('/')[0])}`;
    } else {
      query =
        `name:"${escapePokemonTcgQuery(card)}"`;
      } else if (variant) {

    // Variant names are not consistently represented as a
    // searchable Cardex field, so retrieve Pokémon records
    // and allow RapidUp to filter the variant locally.

    query = 'supertype:Pokémon';

  } else {
    return [];
  }

  try {
    return await pokemonTcgRequest(query);
  } catch (error) {
    console.error(
      'Error searching Pokémon TCG API:',
      error
    );

    throw error;
  }
}

// Compatibility helper for RapidUp's card normalization.
function getPokemonCardVariants(card) {
  return variantNamesFromCard(card);
}
    }
    
