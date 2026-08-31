// poketcg.js

const POKEMON_API_URL =
  'https://api.pokemontcg.io/v2/cards';

const pokemonCardSearchCache =
  new Map();

const pokemonCardMemory =
  new Map();

/*
 * Prevent multiple simultaneous broad-index downloads.
 */
let pokemonCardIndexPromise = null;

let pokemonCardIndexLoaded = false;


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
        .map(card => [
          card.id,
          card
        ])
    ).values()
  ];
}


function cardMatchesText(card, value) {

  const q =
    String(value || '')
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
 * IMPORTANT:
 *
 * We only send valid Pokémon TCG API queries here.
 *
 * Do NOT use:
 *
 * name:*p*
 *
 * because the API does not reliably support a leading
 * wildcard.
 * ------------------------------------------------------------
 */

async function pokemonTcgRequest(
  query,
  page = 1
) {

  const normalizedQuery =
    String(query || '').trim();

  if (!normalizedQuery) {
    return [];
  }

  const key =
    `${normalizedQuery.toLowerCase()}|page:${page}`;

  if (
    pokemonCardSearchCache.has(key)
  ) {
    return pokemonCardSearchCache.get(key);
  }

  const url =
    `${POKEMON_API_URL}` +
    `?q=${encodeURIComponent(normalizedQuery)}` +
    `&page=${page}` +
    `&pageSize=250`;

  const response =
    await fetch(url);

  if (!response.ok) {

    throw new Error(
      `Pokémon TCG API returned ${response.status}`
    );
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
  maxPages = 100
) {

  const normalizedQuery =
    String(query || '').trim();

  if (!normalizedQuery) {
    return [];
  }

  const allCards = [];

  for (
    let page = 1;
    page <= maxPages;
    page++
  ) {

    const cards =
      await pokemonTcgRequest(
        normalizedQuery,
        page
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
 * LOAD POKÉMON INDEX
 * ------------------------------------------------------------
 *
 * We obtain the Pokémon card records through
 * a valid broad query and perform the actual
 * Pokémon-name matching locally.
 *
 * Once loaded, subsequent searches are instant.
 * ------------------------------------------------------------
 */

async function ensurePokemonCardIndex() {

  /*
   * Already loaded.
   */
  if (pokemonCardIndexLoaded) {

    return [
      ...pokemonCardMemory.values()
    ];
  }


  /*
   * Another request is already loading it.
   *
   * Reuse that request rather than starting another
   * complete database download when the user types
   * quickly.
   */
  if (pokemonCardIndexPromise) {

    return pokemonCardIndexPromise;
  }


  pokemonCardIndexPromise =
    (async () => {

      /*
       * Broad but VALID API query.
       *
       * Pokémon TCG API accepts supertype queries.
       */
      const cards =
        await pokemonTcgRequestAll(
          'supertype:Pokémon',
          100
        );

      cards.forEach(card => {

        if (card?.id) {

          pokemonCardMemory.set(
            card.id,
            card
          );
        }
      });

      pokemonCardIndexLoaded =
        true;

      return [
        ...pokemonCardMemory.values()
      ];

    })();

  try {

    return await pokemonCardIndexPromise;

  } finally {

    pokemonCardIndexPromise =
      null;
  }
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
 * PREFIX SEARCH ONLY.
 *
 * The Pokémon search is intentionally based on the
 * BEGINNING of the card name.
 *
 * Examples:
 *
 * P
 *   Pikachu
 *   Pidgey
 *   Pichu
 *   Piplup
 *   Popplio
 *
 * PI
 *   Pikachu
 *   Pichu
 *   Pidgey
 *   Piloswine
 *   Piplup
 *
 * PIKA
 *   Pikachu
 *
 * UNOWN
 *   Unown [A]
 *   Unown [B]
 *   Unown [P]
 *   etc.
 *
 * IMPORTANT:
 *
 * P does NOT match Unown [P].
 *
 * The API is NOT asked to perform the prefix search.
 * JavaScript performs the actual search against the
 * locally cached Pokémon index.
 *
 * Fuzzy / typo matching is intentionally NOT implemented
 * at this stage.
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
   * ----------------------------------------------------------
   * LOCAL MEMORY
   * ----------------------------------------------------------
   *
   * If the index is already loaded, this is instantaneous.
   * ----------------------------------------------------------
   */

  let cards = [
    ...pokemonCardMemory.values()
  ];


  /*
   * ----------------------------------------------------------
   * LOAD INDEX IF NECESSARY
   * ----------------------------------------------------------
   */

  if (!pokemonCardIndexLoaded) {

    try {

      cards =
        await ensurePokemonCardIndex();

    } catch (error) {

      console.error(
        'Pokémon card index lookup failed:',
        error
      );

      /*
       * Fall back to whatever may already be
       * in local memory.
       */
      cards = [
        ...pokemonCardMemory.values()
      ];

      /*
       * If absolutely nothing is available,
       * allow the existing RapidUp error handling
       * to report the failure.
       */
      if (!cards.length) {
        throw error;
      }
    }
  }


  /*
   * ----------------------------------------------------------
   * PREFIX MATCH
   * ----------------------------------------------------------
   *
   * Match ONLY from the beginning of the Pokémon/card name.
   *
   * This deliberately uses startsWith() rather than includes().
   *
   * Example:
   *
   * "P"  -> "Pikachu"       YES
   * "P"  -> "Unown [P]"     NO
   *
   * "PI" -> "Pikachu"       YES
   * "PI" -> "Pichu"         YES
   * "PI" -> "Rapidash"      NO
   * ----------------------------------------------------------
   */

  return uniqueCards(
    cards.filter(card =>
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
}


/*
 * ------------------------------------------------------------
 * SET SEARCH
 * ------------------------------------------------------------
 *
 * Sets are also handled with local substring matching once
 * the index has been loaded.
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


  let cards = [
    ...pokemonCardMemory.values()
  ];


  /*
   * Load the index if necessary.
   */
  if (!pokemonCardIndexLoaded) {

    try {

      cards =
        await ensurePokemonCardIndex();

    } catch (error) {

      console.error(
        'Set lookup failed:',
        error
      );

      cards = [
        ...pokemonCardMemory.values()
      ];

      if (!cards.length) {
        throw error;
      }
    }
  }


  return uniqueCards(
    cards.filter(card =>
      String(
        card?.set?.name || ''
      )
        .toLowerCase()
        .includes(
          searchValue
        )
    )
  );
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
      /^(\d+)(?:\/\d+)?$/
    );


  if (numberMatch) {

    const number =
      numberMatch[1];


    /*
     * Local memory first.
     */

    let localResults =
      [
        ...pokemonCardMemory.values()
      ].filter(card =>
        String(
          card?.number || ''
        )
          .split('/')[0] ===
        number
      );


    /*
     * If the index isn't loaded, retrieve the
     * exact number from the API.
     */
    if (!pokemonCardIndexLoaded) {

      try {

        const apiResults =
          await pokemonTcgRequestAll(
            `number:${number}`,
            100
          );

        localResults =
          uniqueCards([
            ...apiResults,
            ...localResults
          ]);

      } catch (error) {

        console.error(
          'Card number lookup failed:',
          error
        );
      }
    }


    return uniqueCards(
      localResults
    );
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
      /#?(\d+)(?:\/\d+)?$/
    );


  let namePart =
    clean;


  if (embeddedNumber) {

    namePart =
      clean
        .slice(
          0,
          embeddedNumber.index
        )
        .trim();
  }


  let cards = [
    ...pokemonCardMemory.values()
  ];


  /*
   * Load the index if necessary.
   */
  if (!pokemonCardIndexLoaded) {

    try {

      cards =
        await ensurePokemonCardIndex();

    } catch (error) {

      console.error(
        'Card lookup failed:',
        error
      );
    }
  }


  /*
   * ----------------------------------------------------------
   * NAME FILTER
   * ----------------------------------------------------------
   */

  let results =
    cards.filter(card => {

      if (!namePart) {
        return true;
      }

      return String(
        card?.name || ''
      )
        .toLowerCase()
        .includes(
          namePart.toLowerCase()
        );
    });


  /*
   * ----------------------------------------------------------
   * NUMBER FILTER
   * ----------------------------------------------------------
   */

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
}


/*
 * ------------------------------------------------------------
 * VARIANT SEARCH
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


  /*
   * Make sure we have the card index.
   */

  let cards = [
    ...pokemonCardMemory.values()
  ];


  if (!pokemonCardIndexLoaded) {

    try {

      cards =
        await ensurePokemonCardIndex();

    } catch (error) {

      console.error(
        'Variant lookup failed:',
        error
      );

      return [];
    }
  }


  return uniqueCards(
    cards.filter(card =>
      getPokemonCardVariants(
        card
      ).some(v =>
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
   * ----------------------------------------------------------
   * PLAIN TEXT SEARCH
   * ----------------------------------------------------------
   *
   * Plain text is treated as a Pokémon / character search.
   * ----------------------------------------------------------
   */

  if (
    typeof search ===
    'string'
  ) {

    const value =
      search.trim();

    if (!value) {
      return [];
    }

    return searchByPokemon(
      value
    );
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


  let results =
    null;


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
      await searchBySet(
        set
      );


    results =
      results === null
        ? setResults
        : results.filter(
            cardRecord =>
              setResults.some(
                other =>
                  other.id ===
                  cardRecord.id
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
      await searchByCard(
        card
      );


    results =
      results === null
        ? cardResults
        : results.filter(
            cardRecord =>
              cardResults.some(
                other =>
                  other.id ===
                  cardRecord.id
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
      results.filter(
        cardRecord =>
          cardHasVariant(
            cardRecord,
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
  ].sort(
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
  ].sort(
    (a, b) =>
      a.localeCompare(b)
  );
}


function getPokemonCardOptions(
  cards
) {

  return uniqueCards(
    cards || []
  ).sort(
    (a, b) => {

      const setA =
        a?.set?.name || '';

      const setB =
        b?.set?.name || '';


      const setCompare =
        setA.localeCompare(
          setB
        );


      if (
        setCompare !== 0
      ) {

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
    ).forEach(
        variant =>
          variants.add(
            variant
          )
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
 *
 * This remains a pure local filter.
 *
 * Pokémon / character matching is PREFIX based.
 * Set and card matching remain substring based.
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


  return source.filter(
    record => {


      /*
       * Pokémon / character:
       *
       * PREFIX MATCH ONLY.
       *
       * The search must begin at the beginning
       * of the card's Pokémon name.
       *
       * P:
       *   Pikachu       YES
       *   Pidgey        YES
       *   Pichu         YES
       *   Unown [P]     NO
       *
       * PI:
       *   Pikachu       YES
       *   Pichu         YES
       *   Pidgey        YES
       *   Piloswine     YES
       *   Piplup        YES
       *   Rapidash      NO
       *
       * Fuzzy / typo matching is intentionally
       * not implemented yet.
       */

      if (
        pokemon &&
        !String(
          record?.name || ''
        )
          .trim()
          .toLowerCase()
          .startsWith(
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
    }
  );
}


/*
 * ------------------------------------------------------------
 * CACHE MANAGEMENT
 * ------------------------------------------------------------
 */

function clearPokemonTcgCache() {

  pokemonCardSearchCache.clear();

  pokemonCardMemory.clear();

  pokemonCardIndexLoaded =
    false;

  pokemonCardIndexPromise =
    null;
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
