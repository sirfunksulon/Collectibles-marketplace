// poketcg.js - Pokémon TCG API Client & In-Memory Search

const POKEMON_API_URL =
  'https://api.pokemontcg.io/v2/cards';

const pokemonCardSearchCache =
  new Map();

const pokemonCardMemory =
  new Map();

/*
 * Minimum characters required before triggering an outbound
 * Pokémon / Set / Card API search.
 *
 * This is intentionally 3 so typing P / Pi does not create
 * API traffic. Once the user reaches 3 characters, the API
 * is queried and the returned cards are retained in memory.
 */
const MIN_SEARCH_LENGTH = 3;

let activeAbortController = null;


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
        .filter(card => card.id)
        .map(card => [
          card.id,
          card
        ])
    ).values()
  ];
}


function cardMatchesText(card, value) {
  const q = String(value || '')
    .trim()
    .toLowerCase();

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
 *
 * Pokémon searches use a trailing wildcard:
 *
 *     name:pik*
 *
 * rather than an exact-name query:
 *
 *     name:"pik"
 *
 * The API narrows the database and JavaScript performs the
 * final local filtering.
 * ------------------------------------------------------------
 */

async function pokemonTcgRequest(
  query,
  page = 1,
  signal = null
) {
  const normalizedQuery =
    String(query || '').trim();

  if (!normalizedQuery) return [];

  const key =
    `${normalizedQuery.toLowerCase()}|page:${page}`;

  if (pokemonCardSearchCache.has(key)) {
    return pokemonCardSearchCache.get(key);
  }

  const targetUrl =
    `${POKEMON_API_URL}` +
    `?q=${encodeURIComponent(normalizedQuery)}` +
    `&page=${page}` +
    `&pageSize=250`;

  let response;

  try {
    response = await fetch(
      targetUrl,
      signal ? { signal } : undefined
    );

    if (!response.ok) {
      throw new Error(
        `Direct fetch status: ${response.status}`
      );
    }
  } catch (directError) {

    /*
     * Do not send aborted requests through the proxy.
     */
    if (directError?.name === 'AbortError') {
      throw directError;
    }

    /*
     * Preserve the existing CORS proxy fallback.
     */
    console.warn(
      'Direct Pokémon TCG API request failed; trying CORS proxy.',
      directError
    );

    const proxyUrl =
      `https://corsproxy.io/?${encodeURIComponent(targetUrl)}`;

    response = await fetch(
      proxyUrl,
      signal ? { signal } : undefined
    );

    if (!response.ok) {
      throw new Error(
        `Proxy fetch status: ${response.status}`
      );
    }
  }

  const result =
    await response.json();

  const cards =
    Array.isArray(result.data)
      ? result.data
      : [];

  pokemonCardSearchCache.set(
    key,
    cards
  );

  /*
   * Keep every successfully retrieved card
   * in local memory.
   */
  cards.forEach(card => {

    if (card?.id) {
      pokemonCardMemory.set(
        card.id,
        card
      );
    }
  });

  return cards;
}


/*
 * ------------------------------------------------------------
 * PAGINATED API REQUEST
 * ------------------------------------------------------------
 */

async function pokemonTcgRequestAll(
  query,
  maxPages = 100,
  signal = null
) {
  const normalizedQuery =
    String(query || '').trim();

  if (!normalizedQuery) return [];

  const allCards = [];

  for (
    let page = 1;
    page <= maxPages;
    page++
  ) {

    const cards =
      await pokemonTcgRequest(
        normalizedQuery,
        page,
        signal
      );

    if (!cards.length) {
      break;
    }

    allCards.push(
      ...cards
    );

    /*
     * A short page means there are
     * no more results.
     */
    if (cards.length < 250) {
      break;
    }
  }

  return uniqueCards(
    allCards
  );
}


/*
 * ------------------------------------------------------------
 * CARD VARIANTS
 *
 * RARITY IS INTENTIONALLY NOT USED.
 * ------------------------------------------------------------
 */

function getPokemonCardVariants(card) {

  const variants =
    new Set();

  const prices =
    card?.tcgplayer?.prices || {};

  Object.keys(prices)
    .forEach(key => {

      const k =
        key.toLowerCase();

      if (
        k.includes(
          'reverseholo'
        )
      ) {

        variants.add(
          'Reverse Holo'
        );
      }

      if (
        k.includes(
          'holofoil'
        )
      ) {

        variants.add(
          'Holo'
        );
      }

      if (
        k.includes(
          '1stedition'
        )
      ) {

        variants.add(
          '1st Edition'
        );
      }

      if (
        k === 'normal'
      ) {

        variants.add(
          'Normal'
        );
      }
    });


  /*
   * If pricing data is unavailable,
   * use Normal as the presentation fallback.
   */
  if (!variants.size) {

    variants.add(
      'Normal'
    );
  }

  return [
    ...variants
  ];
}


/*
 * ------------------------------------------------------------
 * VARIANT FILTER
 * ------------------------------------------------------------
 */

function cardHasVariant(
  card,
  variant
) {

  if (!variant) {
    return true;
  }

  const wanted =
    String(variant)
      .trim()
      .toLowerCase();

  return getPokemonCardVariants(
    card
  ).some(v =>
    v.toLowerCase() === wanted
  );
}


/*
 * ------------------------------------------------------------
 * POKÉMON / CHARACTER SEARCH
 * ------------------------------------------------------------
 *
 * P / PI:
 *   No outbound API request.
 *   Search whatever is already cached locally.
 *
 * PIK:
 *   API request using name:pik*
 *   Returned cards are cached in memory.
 *
 * The final match is performed locally.
 * ------------------------------------------------------------
 */

async function searchByPokemon(
  value
) {

  const searchValue =
    String(value || '')
      .trim()
      .toLowerCase();

  if (!searchValue) {
    return [];
  }


  /*
   * Local matching helper.
   */
  const localMatches = () =>
    uniqueCards(
      [
        ...pokemonCardMemory.values()
      ]
        .filter(card =>
          String(
            card?.name || ''
          )
            .trim()
            .toLowerCase()
            .startsWith(
              searchValue
            )
        )
    );


  /*
   * Do not call the API until the
   * minimum search length is reached.
   */
  if (
    searchValue.length <
    MIN_SEARCH_LENGTH
  ) {

    return localMatches();
  }


  /*
   * Cancel the previous keypress request.
   */
  if (activeAbortController) {

    activeAbortController.abort();
  }


  activeAbortController =
    new AbortController();

  const controller =
    activeAbortController;


  try {

    const apiCards =
      await pokemonTcgRequestAll(
        `name:${escapePokemonQuery(searchValue)}*`,
        100,
        controller.signal
      );


    return uniqueCards([
      ...pokemonCardMemory.values(),
      ...apiCards
    ])
      .filter(card =>
        String(
          card?.name || ''
        )
          .trim()
          .toLowerCase()
          .startsWith(
            searchValue
          )
      );

  } catch (error) {

    /*
     * A cancelled request is normal when the user
     * continues typing.
     */
    if (
      error?.name ===
      'AbortError'
    ) {

      return localMatches();
    }


    console.error(
      'Pokémon lookup failed:',
      error
    );


    /*
     * If the API fails, still return anything
     * already present in memory.
     */
    return localMatches();

  } finally {

    if (
      activeAbortController ===
      controller
    ) {

      activeAbortController =
        null;
    }
  }
}


/*
 * ------------------------------------------------------------
 * SET SEARCH
 * ------------------------------------------------------------
 */

async function searchBySet(
  value
) {

  const searchValue =
    String(value || '')
      .trim()
      .toLowerCase();

  if (!searchValue) {
    return [];
  }


  const localMatches = () =>
    uniqueCards(
      [
        ...pokemonCardMemory.values()
      ]
        .filter(card =>
          String(
            card?.set?.name || ''
          )
            .toLowerCase()
            .includes(
              searchValue
            )
        )
    );


  /*
   * No API request for short searches.
   */
  if (
    searchValue.length <
    MIN_SEARCH_LENGTH
  ) {

    return localMatches();
  }


  try {

    const apiCards =
      await pokemonTcgRequestAll(
        `set.name:${escapePokemonQuery(searchValue)}*`,
        100
      );


    return uniqueCards([
      ...pokemonCardMemory.values(),
      ...apiCards
    ])
      .filter(card =>
        String(
          card?.set?.name || ''
        )
          .toLowerCase()
          .includes(
            searchValue
          )
      );

  } catch (error) {

    console.error(
      'Set lookup failed:',
      error
    );

    return localMatches();
  }
}


/*
 * ------------------------------------------------------------
 * CARD NAME / NUMBER SEARCH
 * ------------------------------------------------------------
 */

async function searchByCard(
  value
) {

  const q =
    String(value || '')
      .trim();

  if (!q) {
    return [];
  }


  /*
   * Remove leading #.
   */

  const clean =
    q.replace(
      /^#/,
      ''
    );


  /*
   * ----------------------------------------------------------
   * EXACT COLLECTOR NUMBER
   * ----------------------------------------------------------
   */

  const numberMatch =
    clean.match(
      /^([0-9]+)(?:\/[0-9]+)?$/
    );


  if (numberMatch) {

    const number =
      numberMatch[1];


    try {

      const apiResults =
        await pokemonTcgRequestAll(
          `number:${number}`,
          100
        );


      return uniqueCards([
        ...apiResults,
        ...pokemonCardMemory.values()
      ])
        .filter(card =>
          String(
            card?.number || ''
          )
            .split('/')[0] ===
          number
        );

    } catch (error) {

      console.error(
        'Card number lookup failed:',
        error
      );


      return uniqueCards(
        [
          ...pokemonCardMemory.values()
        ]
          .filter(card =>
            String(
              card?.number || ''
            )
              .split('/')[0] ===
            number
          )
      );
    }
  }


  /*
   * ----------------------------------------------------------
   * NAME / EMBEDDED NUMBER
   * ----------------------------------------------------------
   *
   * Examples:
   *
   * Breloom
   * Breloom #16
   * Pikachu 58
   * ----------------------------------------------------------
   */

  const embeddedNumber =
    clean.match(
      /#?([0-9]+)(?:\/[0-9]+)?$/
    );


  const namePart =
    embeddedNumber
      ? clean
          .slice(
            0,
            embeddedNumber.index
          )
          .trim()
      : clean;


  const normalizedName =
    namePart.toLowerCase();


  /*
   * Local fallback.
   */

  const localMatches = () => {

    let results =
      [
        ...pokemonCardMemory.values()
      ]
        .filter(card =>
          !normalizedName ||
          String(
            card?.name || ''
          )
            .toLowerCase()
            .includes(
              normalizedName
            )
        );


    if (embeddedNumber) {

      const number =
        embeddedNumber[1];

      results =
        results.filter(card =>
          String(
            card?.number || ''
          )
            .split('/')[0] ===
          number
        );
    }


    return uniqueCards(
      results
    );
  };


  /*
   * Do not call API for short card-name searches.
   */
  if (
    normalizedName &&
    normalizedName.length <
    MIN_SEARCH_LENGTH
  ) {

    return localMatches();
  }


  try {

    const apiCards =
      normalizedName
        ? await pokemonTcgRequestAll(
            `name:${escapePokemonQuery(normalizedName)}*`,
            100
          )
        : [];


    let results =
      uniqueCards([
        ...apiCards,
        ...pokemonCardMemory.values()
      ])
        .filter(card =>
          !normalizedName ||
          String(
            card?.name || ''
          )
            .toLowerCase()
            .includes(
              normalizedName
            )
        );


    if (embeddedNumber) {

      const number =
        embeddedNumber[1];

      results =
        results.filter(card =>
          String(
            card?.number || ''
          )
            .split('/')[0] ===
          number
        );
    }


    return uniqueCards(
      results
    );

  } catch (error) {

    console.error(
      'Card lookup failed:',
      error
    );

    return localMatches();
  }
}


/*
 * ------------------------------------------------------------
 * VARIANT SEARCH
 * ------------------------------------------------------------
 *
 * Variants are derived from pricing data already loaded.
 * No API call is necessary here.
 * ------------------------------------------------------------
 */

async function searchByVariant(
  value
) {

  const q =
    String(value || '')
      .trim()
      .toLowerCase();


  if (!q) {

    return [
      ...pokemonCardMemory.values()
    ];
  }


  return uniqueCards(
    [
      ...pokemonCardMemory.values()
    ]
      .filter(card =>
        getPokemonCardVariants(
          card
        )
          .some(v =>
            v.toLowerCase()
              .includes(q)
          )
      )
  );
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

async function searchPokemonCards(
  search
) {


  /*
   * Plain text =
   * Pokémon / character search.
   */

  if (
    typeof search ===
    'string'
  ) {

    const value =
      search.trim();

    return value
      ? await searchByPokemon(
          value
        )
      : [];
  }


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


  let results =
    null;


  /*
   * Pokémon.
   */

  if (pokemon) {

    results =
      await searchByPokemon(
        pokemon
      );
  }


  /*
   * Set.
   */

  if (set) {

    const setResults =
      await searchBySet(
        set
      );


    results =
      results === null
        ? setResults
        : results.filter(
            record =>
              setResults.some(
                other =>
                  other.id ===
                  record.id
              )
          );
  }


  /*
   * Card.
   */

  if (card) {

    const cardResults =
      await searchByCard(
        card
      );


    results =
      results === null
        ? cardResults
        : results.filter(
            record =>
              cardResults.some(
                other =>
                  other.id ===
                  record.id
              )
          );
  }


  /*
   * Nothing entered.
   */

  if (results === null) {

    results = [
      ...pokemonCardMemory.values()
    ];
  }


  /*
   * Variant.
   */

  if (variant) {

    results =
      results.filter(
        record =>
          cardHasVariant(
            record,
            variant
          )
      );
  }


  return uniqueCards(
    results
  );
}


/*
 * ------------------------------------------------------------
 * COMPATIBILITY FUNCTION
 * ------------------------------------------------------------
 */

async function fetchPokemonCard(
  cardName
) {

  const query =
    String(
      cardName || ''
    ).trim();

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

function getPokemonNames(
  cards
) {

  return [
    ...new Set(
      (cards || [])
        .map(
          card =>
            card?.name
        )
        .filter(Boolean)
    )
  ]
    .sort(
      (a, b) =>
        a.localeCompare(b)
    );
}


function getPokemonSets(
  cards
) {

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
  ]
    .sort(
      (a, b) =>
        a.localeCompare(b)
    );
}


function getPokemonCardOptions(
  cards
) {

  return uniqueCards(
    cards || []
  )
    .sort(
      (a, b) => {

        const setCompare =
          (a?.set?.name || '')
            .localeCompare(
              b?.set?.name || ''
            );


        if (
          setCompare !== 0
        ) {

          return setCompare;
        }


        return (
          a?.number || ''
        )
          .localeCompare(
            b?.number || '',
            undefined,
            {
              numeric: true
            }
          );
      }
    );
}


function getPokemonVariants(
  cards
) {

  const variants =
    new Set();


  (cards || [])
    .forEach(card => {

      getPokemonCardVariants(
        card
      )
        .forEach(
          v =>
            variants.add(v)
        );
    });


  return [
    ...variants
  ]
    .sort(
      (a, b) =>
        a.localeCompare(b)
    );
}


/*
 * ------------------------------------------------------------
 * LOCAL FILTER
 * ------------------------------------------------------------
 *
 * Pokémon matching uses prefix matching to remain consistent
 * with the autocomplete/search behavior.
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
    )
      .trim()
      .toLowerCase();


  const set =
    String(
      criteria?.set || ''
    )
      .trim()
      .toLowerCase();


  const card =
    String(
      criteria?.card || ''
    )
      .trim();


  const variant =
    String(
      criteria?.variant || ''
    )
      .trim();


  return source.filter(
    record => {

      /*
       * Pokémon / character.
       */

      if (
        pokemon &&
        !String(
          record?.name || ''
        )
          .trim()
          .toLowerCase()
          .startsWith(
            pokemon
          )
      ) {

        return false;
      }


      /*
       * Set.
       */

  
