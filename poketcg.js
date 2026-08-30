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
  const q = String(value || '')
    .trim()
    .toLowerCase();

  if (!q) {
    return true;
  }

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
 *
 * Supports normal single-page requests.
 *
 * pageSize is capped at 250 by the Pokémon TCG API.
 * ------------------------------------------------------------
 */

async function pokemonTcgRequest(query, page = 1) {
  const normalizedQuery = String(query || '').trim();

  if (!normalizedQuery) {
    return [];
  }

  const key =
    `${normalizedQuery.toLowerCase()}|page:${page}`;

  if (pokemonCardSearchCache.has(key)) {
    return pokemonCardSearchCache.get(key);
  }

  const url =
    `${POKEMON_API_URL}` +
    `?q=${encodeURIComponent(normalizedQuery)}` +
    `&page=${page}` +
    `&pageSize=250`;

  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(
      `Pokémon TCG API returned ${response.status}`
    );
  }

  const result = await response.json();

  const cards = Array.isArray(result.data)
    ? result.data
    : [];

  pokemonCardSearchCache.set(key, cards);

  /*
   * Keep every successfully retrieved card in local memory.
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
 * PAGINATED API REQUEST
 * ------------------------------------------------------------
 *
 * Used for broad searches such as:
 *
 * P
 * PI
 * E
 * A
 *
 * A single API request only returns a maximum of 250 cards.
 *
 * This continues requesting pages until there are no more
 * matching cards.
 * ------------------------------------------------------------
 */

async function pokemonTcgRequestAll(query, maxPages = 20) {
  const normalizedQuery = String(query || '').trim();

  if (!normalizedQuery) {
    return [];
  }

  const allCards = [];

  for (let page = 1; page <= maxPages; page++) {

    const cards = await pokemonTcgRequest(
      normalizedQuery,
      page
    );

    if (!cards.length) {
      break;
    }

    allCards.push(...cards);

    /*
     * If fewer than 250 were returned, this was the final page.
     */
    if (cards.length < 250) {
      break;
    }
  }

  return uniqueCards(allCards);
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

  const prices =
    card?.tcgplayer?.prices || {};

  Object.keys(prices).forEach(key => {

    const k =
      key.toLowerCase();

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
   * Do not invent rarity information.
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

  if (!variant) {
    return true;
  }

  const wanted =
    String(variant)
      .trim()
      .toLowerCase();

  return getPokemonCardVariants(card)
    .some(v =>
      v.toLowerCase() === wanted
    );
}


/*
 * ------------------------------------------------------------
 * POKÉMON / CHARACTER SEARCH
 * ------------------------------------------------------------
 *
 * THIS IS THE IMPORTANT CHANGE.
 *
 * The Pokémon field is a SUBSTRING search.
 *
 * Examples:
 *
 * P
 *   Pikachu
 *   Pidgey
 *   Popplio
 *   Piplup
 *   Unown [P]
 *   Espurr
 *   etc.
 *
 * PI
 *   Pikachu
 *   Pichu
 *   Pidgey
 *   Piloswine
 *   Piplup
 *   Unown [P] does NOT match because "pi" isn't
 *   contained in "unown [p]"
 *
 * UNOWN
 *   Unown [A]
 *   Unown [B]
 *   Unown [P]
 *   etc.
 *
 * The API is used only to obtain candidates.
 * JavaScript performs the FINAL contains() check.
 * ------------------------------------------------------------
 */

async function searchByPokemon(value) {

  const searchValue =
    String(value || '')
      .trim()
      .toLowerCase();

  if (!searchValue) {
    return [];
  }


  /*
   * ----------------------------------------------------------
   * LOCAL MEMORY FIRST
   * ----------------------------------------------------------
   */

  const localResults =
    [...pokemonCardMemory.values()]
      .filter(card =>
        String(card?.name || '')
          .toLowerCase()
          .includes(searchValue)
      );


  /*
   * ----------------------------------------------------------
   * API SEARCH
   * ----------------------------------------------------------
   *
   * We deliberately search for the text anywhere in the name.
   *
   * Example:
   *
   * P
   * -> name:*p*
   *
   * PI
   * -> name:*pi*
   *
   * UNOWN
   * -> name:*unown*
   *
   * The JavaScript filter below remains the authority.
   * ----------------------------------------------------------
   */

  const escaped =
    escapePokemonQuery(value);

  let apiResults = [];

  try {

    apiResults =
      await pokemonTcgRequestAll(
        `name:*${escaped}*`
      );

  } catch (error) {

    console.error(
      'Pokémon name lookup failed:',
      error
    );

    /*
     * If API access fails but we have already retrieved
     * matching cards, continue using local memory.
     */
  }


  /*
   * ----------------------------------------------------------
   * MERGE API + LOCAL RESULTS
   * ----------------------------------------------------------
   */

  const combined =
    uniqueCards([
      ...apiResults,
      ...localResults
    ]);


  /*
   * ----------------------------------------------------------
   * FINAL SUBSTRING FILTER
   * ----------------------------------------------------------
   *
   * This guarantees that the API's interpretation of the
   * wildcard cannot change the behavior we want.
   * ----------------------------------------------------------
   */

  return combined.filter(card =>
    String(card?.name || '')
      .toLowerCase()
      .includes(searchValue)
  );
}


/*
 * ------------------------------------------------------------
 * SET SEARCH
 * ------------------------------------------------------------
 */

async function searchBySet(value) {

  const searchValue =
    String(value || '')
      .trim()
      .toLowerCase();

  if (!searchValue) {
    return [];
  }


  /*
   * Local memory.
   */

  const localResults =
    [...pokemonCardMemory.values()]
      .filter(card =>
        String(card?.set?.name || '')
          .toLowerCase()
          .includes(searchValue)
      );


  /*
   * API search.
   */

  const escaped =
    escapePokemonQuery(value);

  let apiResults = [];

  try {

    apiResults =
      await pokemonTcgRequestAll(
        `set.name:*${escaped}*`
      );

  } catch (error) {

    console.error(
      'Set lookup failed:',
      error
    );
  }


  return uniqueCards([
    ...apiResults,
    ...localResults
  ]).filter(card =>
    String(card?.set?.name || '')
      .toLowerCase()
      .includes(searchValue)
  );
}


/*
 * ------------------------------------------------------------
 * CARD NAME / NUMBER SEARCH
 * ------------------------------------------------------------
 */

async function searchByCard(value) {

  const q =
    String(value || '').trim();

  if (!q) {
    return [];
  }


  /*
   * Remove leading #.
   */

  const clean =
    q.replace(/^#/, '');


  /*
   * ----------------------------------------------------------
   * EXACT COLLECTOR NUMBER
   *
   * 16
   * 16/165
   * #16
   * #16/165
   * ----------------------------------------------------------
   */

  const numberMatch =
    clean.match(
      /^(\d+)(?:\/\d+)?$/
    );


  if (numberMatch) {

    const number =
      numberMatch[1];


    const localResults =
      [...pokemonCardMemory.values()]
        .filter(card =>
          String(card?.number || '')
            .split('/')[0] === number
        );


    let apiResults = [];

    try {

      apiResults =
        await pokemonTcgRequestAll(
          `number:${number}`
        );

    } catch (error) {

      console.error(
        'Card number lookup failed:',
        error
      );
    }


    return uniqueCards([
      ...apiResults,
      ...localResults
    ]);
  }


  /*
   * ----------------------------------------------------------
   * CARD NAME / EMBEDDED NUMBER
   *
   * Breloom
   * Breloom #16
   * Pikachu 58
   * ----------------------------------------------------------
   */

  const embeddedNumber =
    clean.match(
      /#?(\d+)(?:\/\d+)?$/
    );


  let namePart = clean;

  if (embeddedNumber) {

    namePart =
      clean
        .slice(
          0,
          embeddedNumber.index
        )
        .trim();
  }


  const searches = [];


  /*
   * Card name.
   */

  if (namePart) {

    searches.push(
      pokemonTcgRequestAll(
        `name:*${escapePokemonQuery(namePart)}*`
      )
    );
  }


  /*
   * Embedded collector number.
   */

  if (embeddedNumber) {

    searches.push(
      pokemonTcgRequestAll(
        `number:${embeddedNumber[1]}`
      )
    );
  }


  let results = [];

  try {

    const searchResults =
      await Promise.all(searches);

    results =
      searchResults.flat();

  } catch (error) {

    console.error(
      'Card lookup failed:',
      error
    );
  }


  /*
   * Local memory.
   */

  const localResults =
    [...pokemonCardMemory.values()]
      .filter(card =>
        cardMatchesText(
          card,
          namePart || clean
        )
      );


  return uniqueCards([
    ...results,
    ...localResults
  ]);
}


/*
 * ------------------------------------------------------------
 * VARIANT SEARCH
 * ------------------------------------------------------------
 */

async function searchByVariant(value) {

  const q =
    String(value || '')
      .trim()
      .toLowerCase();


  if (!q) {

    return [
      ...pokemonCardMemory.values()
    ];
  }


  /*
   * Search local memory first.
   */

  const cached =
    [...pokemonCardMemory.values()]
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
   * Broad fallback.
   */

  try {

    const results =
      await pokemonTcgRequestAll(
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
 * ------------------------------------------------------------
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
 * ------------------------------------------------------------
 */

async function searchPokemonCards(search) {

  /*
   * ----------------------------------------------------------
   * PLAIN TEXT SEARCH
   * ----------------------------------------------------------
   */

  if (typeof search === 'string') {

    const value =
      search.trim();

    if (!value) {
      return [];
    }


    /*
     * A plain text search is treated primarily as a Pokémon
     * / character search.
     *
     * This prevents the Pokémon field from accidentally
     * becoming a weird combination of set + card searches.
     */

    return searchByPokemon(value);
  }


  /*
   * ----------------------------------------------------------
   * OBJECT / MULTI-FIELD SEARCH
   * ----------------------------------------------------------
   */

  const criteria =
    search || {};


  const pokemon =
    String(
      criteria.pokemon || ''
    ).trim();


  const set =
    String(
      criteria.set || ''
    ).trim();


  const card =
    String(
      criteria.card || ''
    ).trim();


  const variant =
    String(
      criteria.variant || ''
    ).trim();


  let results = null;


  /*
   * ----------------------------------------------------------
   * POKÉMON
   * ----------------------------------------------------------
   */

  if (pokemon) {

    results =
      await searchByPokemon(
        pokemon
      );
  }


  /*
   * ----------------------------------------------------------
   * SET
   * ----------------------------------------------------------
   */

  if (set) {

    const setResults =
      await searchBySet(set);


    results =
      results === null
        ? setResults
        : results.filter(cardRecord =>
            setResults.some(
              other =>
                other.id === cardRecord.id
            )
          );
  }


  /*
   * ----------------------------------------------------------
   * CARD
   * ----------------------------------------------------------
   */

  if (card) {

    const cardResults =
      await searchByCard(card);


    results =
      results === null
        ? cardResults
        : results.filter(cardRecord =>
            cardResults.some(
              other =>
                other.id === cardRecord.id
            )
          );
  }


  /*
   * ----------------------------------------------------------
   * NOTHING ENTERED
   * ----------------------------------------------------------
   */

  if (results === null) {

    results = [
      ...pokemonCardMemory.values()
    ];
  }


  /*
   * ----------------------------------------------------------
   * VARIANT
   * ----------------------------------------------------------
   */

  if (variant) {

    results =
      results.filter(cardRecord =>
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
 * ------------------------------------------------------------
 */

async function fetchPokemonCard(cardName) {

  const query =
    String(cardName || '').trim();


  if (!query) {
    return [];
  }


  try {

    return await searchPokemonCards(
      query
    );

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
        .filter(
          card =>
            card?.set?.id
        )
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

  return uniqueCards(
    cards || []
  ).sort((a, b) => {

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

  const variants =
    new Set();


  (cards || []).forEach(card => {

    getPokemonCardVariants(card)
      .forEach(variant =>
        variants.add(variant)
      );
  });


  return [
    ...variants
  ].sort(
    (a, b) =>
      a.localeCompare(b)
  );
}


/*
 * ------------------------------------------------------------
 * LOCAL FILTER
 * ------------------------------------------------------------
 */

function filterPokemonCards(
  cards,
  criteria
) {

  const source =
    Array.isArray(cards)
      ? cards
      : [];


  const pokemon =
    String(
      criteria?.pokemon || ''
    ).trim();


  const set =
    String(
      criteria?.set || ''
    ).trim();


  const card =
    String(
      criteria?.card || ''
    ).trim();


  const variant =
    String(
      criteria?.variant || ''
    ).trim();


  return source.filter(record => {

    /*
     * Pokémon / character:
     *
     * TRUE SUBSTRING MATCH.
     */

    if (
      pokemon &&
      !String(
        record?.name || ''
      )
        .toLowerCase()
        .includes(
          pokemon.toLowerCase()
        )
    ) {

      return false;
    }


    /*
     * Set:
     *
     * TRUE SUBSTRING MATCH.
     */

    if (
      set &&
      !String(
        record?.set?.name || ''
      )
        .toLowerCase()
        .includes(
          set.toLowerCase()
        )
    ) {

      return false;
    }


    /*
     * Card name / number.
     */

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


    /*
     * Variant.
     */

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
 * CACHE MANAGEMENT
 * ------------------------------------------------------------
 */

function clearPokemonTcgCache() {

  pokemonCardSearchCache.clear();

  pokemonCardMemory.clear();
}


/*
 * ------------------------------------------------------------
 * GLOBAL EXPOSURE
 *
 * poketcg.js is loaded as a normal script by RapidUp.
 * ------------------------------------------------------------
 */

window.searchPokemonCards =
  searchPokemonCards;

window.fetchPokemonCard =
  fetchPokemonCard;

window.getPokemonCardVariants =
  getPokemonCardVariants;

window.getPokemonNames =
  getPokemonNames;

window.getPokemonSets =
  getPokemonSets;

window.getPokemonCardOptions =
  getPokemonCardOptions;

window.getPokemonVariants =
  getPokemonVariants;

window.filterPokemonCards =
  filterPokemonCards;

window.clearPokemonTcgCache =
  clearPokemonTcgCache;
