// poketcg.js
const POKEMON_API_URL = 'https://api.pokemontcg.io/v2/cards';

const pokemonCardSearchCache = new Map();
const pokemonCardMemory = new Map();

/*
 * ------------------------------------------------------------
 * BASIC HELPERS
 * ------------------------------------------------------------
 */

function escapePokemonQuery(value) {
  return String(value || '')
    .trim()
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}

function uniqueCards(cards) {
  return [
    ...new Map(
      (cards || [])
        .filter(Boolean)
        .map(card => [card.id, card])
    ).values()
  ];
}

function cardMatchesText(card, value) {
  const q = String(value || '').trim().toLowerCase();

  if (!q) return true;

  const haystack = [
    card?.name,
    card?.number,
    card?.set?.name,
    card?.set?.id,
    ...(card?.types || []),
    ...(card?.subtypes || [])
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes(q);
}


/*
 * ------------------------------------------------------------
 * API REQUEST
 * ------------------------------------------------------------
 */

async function pokemonTcgRequest(query) {
  const normalizedQuery = String(query || '').trim();

  if (!normalizedQuery) return [];

  const key = normalizedQuery.toLowerCase();

  if (pokemonCardSearchCache.has(key)) {
    return pokemonCardSearchCache.get(key);
  }

  const response = await fetch(
    `${POKEMON_API_URL}?q=${encodeURIComponent(normalizedQuery)}&pageSize=250`
  );

  if (!response.ok) {
    throw new Error(`Pokémon TCG API returned ${response.status}`);
  }

  const result = await response.json();

  const cards = Array.isArray(result.data)
    ? result.data
    : [];

  pokemonCardSearchCache.set(key, cards);

  /*
   * Keep a local memory of every card we've already seen.
   * This makes subsequent filtering essentially instantaneous.
   */
  cards.forEach(card => {
    if (card?.id) {
      pokemonCardMemory.set(card.id, card);
    }
  });

  return cards;
}


/*
 * ------------------------------------------------------------
 * CARD VARIANTS
 *
 * RARITY IS INTENTIONALLY NOT USED.
 * ------------------------------------------------------------
 */

function getPokemonCardVariants(card) {
  const variants = new Set();

  const prices = card?.tcgplayer?.prices || {};

  Object.keys(prices).forEach(key => {
    const k = key.toLowerCase();

    if (k.includes('reverseholo')) {
      variants.add('Reverse Holo');
    }

    if (k.includes('holofoil')) {
      variants.add('Holo');
    }

    if (k.includes('1stedition')) {
      variants.add('1st Edition');
    }

    if (k === 'normal') {
      variants.add('Normal');
    }
  });

  /*
   * If pricing data is unavailable, don't invent a rarity.
   * Normal is simply the safest presentation fallback.
   */
  if (!variants.size) {
    variants.add('Normal');
  }

  return [...variants];
}


/*
 * ------------------------------------------------------------
 * VARIANT FILTER
 * ------------------------------------------------------------
 */

function cardHasVariant(card, variant) {
  if (!variant) return true;

  const wanted = String(variant)
    .trim()
    .toLowerCase();

  return getPokemonCardVariants(card)
    .some(v => v.toLowerCase() === wanted);
}


/*
 * ------------------------------------------------------------
 * PARTIAL / AUTOCOMPLETE SEARCH
 *
 * These use wildcard queries supported by the Pokémon TCG API.
 * ------------------------------------------------------------
 */

async function searchByPokemon(value) {
  const q = escapePokemonQuery(value);

  if (!q) {
    return [];
  }

  const results = await pokemonTcgRequest(
    `name:${q}*`
  );

  return uniqueCards(results);
}


async function searchBySet(value) {
  const q = escapePokemonQuery(value);

  if (!q) {
    return [];
  }

  const results = await pokemonTcgRequest(
    `set.name:${q}*`
  );

  return uniqueCards(results);
}


async function searchByCard(value) {
  const q = String(value || '').trim();

  if (!q) {
    return [];
  }

  /*
   * Remove a leading #.
   */
  const clean = q.replace(/^#/, '');

  /*
   * Exact collector number:
   *
   * 16
   * 16/165
   * #16
   * #16/165
   */
  const numberMatch = clean.match(/^(\d+)(?:\/\d+)?$/);

  if (numberMatch) {
    return uniqueCards(
      await pokemonTcgRequest(
        `number:${numberMatch[1]}`
      )
    );
  }

  /*
   * Something like:
   *
   * Breloom
   * Breloom #16
   * Pikachu 58
   */
  const embeddedNumber = clean.match(
    /#?(\d+)(?:\/\d+)?$/
  );

  const searches = [];

  /*
   * Name portion.
   */
  let namePart = clean;

  if (embeddedNumber) {
    namePart = clean
      .slice(0, embeddedNumber.index)
      .trim();
  }

  if (namePart) {
    searches.push(
      pokemonTcgRequest(
        `name:${escapePokemonQuery(namePart)}*`
      )
    );
  }

  /*
   * Embedded number.
   */
  if (embeddedNumber) {
    searches.push(
      pokemonTcgRequest(
        `number:${embeddedNumber[1]}`
      )
    );
  }

  const results = await Promise.all(searches);

  return uniqueCards(results.flat());
}


/*
 * ------------------------------------------------------------
 * VARIANT SEARCH
 *
 * Variants are presentation types, not rarity.
 *
 * We search cards already cached first.
 * If nothing is cached, use a broad API request.
 * ------------------------------------------------------------
 */

async function searchByVariant(value) {
  const q = String(value || '')
    .trim()
    .toLowerCase();

  if (!q) {
    return [...pokemonCardMemory.values()];
  }

  const cached = [...pokemonCardMemory.values()]
    .filter(card =>
      getPokemonCardVariants(card)
        .some(v =>
          v.toLowerCase().includes(q)
        )
    );

  if (cached.length) {
    return cached;
  }

  /*
   * Don't repeatedly request the entire database.
   * A broad Pokémon page gives us candidate records that
   * can then be retained locally.
   */
  try {
    const results = await pokemonTcgRequest(
      'supertype:Pokémon'
    );

    return uniqueCards(
      results.filter(card =>
        getPokemonCardVariants(card)
          .some(v =>
            v.toLowerCase().includes(q)
          )
      )
    );
  } catch (error) {
    console.error(
      'Variant lookup failed:',
      error
    );

    return [];
  }
}


/*
 * ------------------------------------------------------------
 * MAIN SEARCH FUNCTION
 *
 * Supports:
 *
 * searchPokemonCards("Pikachu")
 *
 * OR:
 *
 * searchPokemonCards({
 *   pokemon: "Pikachu"
 * })
 *
 * OR:
 *
 * searchPokemonCards({
 *   set: "Base Set"
 * })
 *
 * OR:
 *
 * searchPokemonCards({
 *   card: "16"
 * })
 *
 * OR:
 *
 * searchPokemonCards({
 *   pokemon: "Pikachu",
 *   set: "Base Set",
 *   card: "58",
 *   variant: "Holo"
 * })
 *
 * This preserves the interface your HTML is already using.
 * ------------------------------------------------------------
 */

async function searchPokemonCards(search) {

  /*
   * Plain text lookup.
   */
  if (typeof search === 'string') {
    const value = search.trim();

    if (!value) {
      return [];
    }

    const results = await Promise.all([
      searchByPokemon(value),
      searchBySet(value),
      searchByCard(value)
    ]);

    return uniqueCards(
      results.flat()
    );
  }


  /*
   * Object / multi-field lookup.
   */
  const criteria = search || {};

  const pokemon = String(
    criteria.pokemon || ''
  ).trim();

  const set = String(
    criteria.set || ''
  ).trim();

  const card = String(
    criteria.card || ''
  ).trim();

  const variant = String(
    criteria.variant || ''
  ).trim();


  /*
   * Start with the broadest applicable field.
   */
  let results = null;


  /*
   * Pokémon / character.
   */
  if (pokemon) {
    results = await searchByPokemon(pokemon);
  }


  /*
   * Set.
   */
  if (set) {
    const setResults = await searchBySet(set);

    results = results === null
      ? setResults
      : results.filter(card =>
          setResults.some(
            other => other.id === card.id
          )
        );
  }


  /*
   * Card name / number.
   */
  if (card) {
    const cardResults = await searchByCard(card);

    results = results === null
      ? cardResults
      : results.filter(cardRecord =>
          cardResults.some(
            other => other.id === cardRecord.id
          )
        );
  }


  /*
   * If no searchable field is entered,
   * return the locally known cards.
   */
  if (results === null) {
    results = [
      ...pokemonCardMemory.values()
    ];
  }


  /*
   * Variant is applied locally because it represents
   * presentation data derived from TCGPlayer pricing.
   */
  if (variant) {
    results = results.filter(cardRecord =>
      cardHasVariant(
        cardRecord,
        variant
      )
    );
  }


  return uniqueCards(results);
}


/*
 * ------------------------------------------------------------
 * COMPATIBILITY FUNCTION
 *
 * Existing RapidUp code may call this.
 * ------------------------------------------------------------
 */

async function fetchPokemonCard(cardName) {
  const query = String(cardName || '').trim();

  if (!query) {
    return [];
  }

  try {
    return await searchPokemonCards(query);
  } catch (error) {
    console.error(
      'Error fetching Pokémon TCG API data:',
      error
    );

    throw error;
  }
}


/*
 * ------------------------------------------------------------
 * AUTOCOMPLETE OPTIONS
 *
 * These helper functions are safe for the existing HTML to use
 * if it wants to populate dropdowns from currently loaded cards.
 * ------------------------------------------------------------
 */

function getPokemonNames(cards) {
  return [
    ...new Set(
      (cards || [])
        .map(card => card?.name)
        .filter(Boolean)
    )
  ].sort(
    (a, b) =>
      a.localeCompare(b)
  );
}


function getPokemonSets(cards) {
  return [
    ...new Map(
      (cards || [])
        .filter(card => card?.set?.id)
        .map(card => [
          card.set.id,
          card.set.name
        ])
    ).values()
  ].sort(
    (a, b) =>
      a.localeCompare(b)
  );
}


function getPokemonCardOptions(cards) {
  return uniqueCards(cards || [])
    .sort((a, b) => {

      const setA =
        a?.set?.name || '';

      const setB =
        b?.set?.name || '';

      const setCompare =
        setA.localeCompare(setB);

      if (setCompare !== 0) {
        return setCompare;
      }

      const numberA =
        a?.number || '';

      const numberB =
        b?.number || '';

      return numberA.localeCompare(
        numberB,
        undefined,
        {
          numeric: true
        }
      );
    });
}


function getPokemonVariants(cards) {
  const variants = new Set();

  (cards || []).forEach(card => {
    getPokemonCardVariants(card)
      .forEach(variant =>
        variants.add(variant)
      );
  });

  return [...variants].sort(
    (a, b) =>
      a.localeCompare(b)
  );
}


/*
 * ------------------------------------------------------------
 * OPTIONAL LOCAL FILTER
 *
 * Useful when the HTML has already retrieved a candidate set
 * and wants instant filtering while the user types.
 * ------------------------------------------------------------
 */

function filterPokemonCards(cards, criteria) {
  const source = Array.isArray(cards)
    ? cards
    : [];

  const pokemon = String(
    criteria?.pokemon || ''
  ).trim();

  const set = String(
    criteria?.set || ''
  ).trim();

  const card = String(
    criteria?.card || ''
  ).trim();

  const variant = String(
    criteria?.variant || ''
  ).trim();


  return source.filter(record => {

    if (
      pokemon &&
      !cardMatchesText(
        {
          name: record?.name
        },
        pokemon
      )
    ) {
      return false;
    }


    if (
      set &&
      !String(record?.set?.name || '')
        .toLowerCase()
        .includes(
          set.toLowerCase()
        )
    ) {
      return false;
    }


    if (card) {
      const cardText = [
        record?.name,
        record?.number
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();

      if (
        !cardText.includes(
          card.toLowerCase()
        )
      ) {
        return false;
      }
    }


    if (
      variant &&
      !cardHasVariant(
        record,
        variant
      )
    ) {
      return false;
    }


    return true;
  });
}


/*
 * ------------------------------------------------------------
 * PRELOAD
 *
 * Deliberately lightweight.
 *
 * We don't download the entire Pokémon database on page load.
 * Instead, every successful search is cached and becomes
 * instantaneous on subsequent filtering.
 * ------------------------------------------------------------
 */

function clearPokemonTcgCache() {
  pokemonCardSearchCache.clear();
  pokemonCardMemory.clear();
}


/*
 * Expose compatibility helpers globally.
 *
 * This is important because poketcg.js is loaded as a normal
 * script by the RapidUp HTML.
 */
window.searchPokemonCards = searchPokemonCards;
window.fetchPokemonCard = fetchPokemonCard;
window.getPokemonCardVariants = getPokemonCardVariants;
window.getPokemonNames = getPokemonNames;
window.getPokemonSets = getPokemonSets;
window.getPokemonCardOptions = getPokemonCardOptions;
window.getPokemonVariants = getPokemonVariants;
window.filterPokemonCards = filterPokemonCards;
window.clearPokemonTcgCache = clearPokemonTcgCache;
