// poketcg.js - Pokémon TCG API Client & In-Memory Search

const POKEMON_API_URL = 'https://api.pokemontcg.io/v2/cards';
const MIN_SEARCH_LENGTH = 3;
const AUTOCOMPLETE_PAGE_SIZE = 250;

const pokemonCardSearchCache = new Map();
const pokemonCardMemory = new Map();
let activeAbortController = null;

// Expose the threshold to the existing RapidUp HTML autocomplete layer.
window.POKEMON_TCG_MIN_SEARCH_LENGTH = MIN_SEARCH_LENGTH;

function escapePokemonQuery(value) {
  return String(value || '').trim().replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function uniqueCards(cards) {
  return [...new Map((cards || [])
    .filter(Boolean)
    .filter(card => card.id)
    .map(card => [card.id, card]))
    .values()];
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
  ].filter(Boolean).join(' ').toLowerCase();

  return haystack.includes(q);
}

async function pokemonTcgRequest(
  query,
  page = 1,
  signal = null,
  pageSize = AUTOCOMPLETE_PAGE_SIZE
) {
  const normalizedQuery = String(query || '').trim();

  if (!normalizedQuery) return [];

  const key =
    `${normalizedQuery.toLowerCase()}|page:${page}|size:${pageSize}`;

  if (pokemonCardSearchCache.has(key)) {
    return pokemonCardSearchCache.get(key);
  }

  const targetUrl =
    `${POKEMON_API_URL}` +
    `?q=${encodeURIComponent(normalizedQuery)}` +
    `&page=${page}` +
    `&pageSize=${pageSize}`;

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

    if (directError?.name === 'AbortError') {
      throw directError;
    }

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

    if (!cards.length) break;

    allCards.push(
      ...cards
    );

    if (
      cards.length <
      AUTOCOMPLETE_PAGE_SIZE
    ) {
      break;
    }
  }

  return uniqueCards(
    allCards
  );
}


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

  if (!variants.size) {
    variants.add(
      'Normal'
    );
  }

  return [
    ...variants
  ];
}


function cardHasVariant(
  card,
  variant
) {
  if (!variant) return true;

  const wanted =
    String(variant)
      .trim()
      .toLowerCase();

  return getPokemonCardVariants(
    card
  ).some(
    v =>
      v.toLowerCase() ===
      wanted
  );
}


function localPokemonMatches(
  searchValue
) {
  return uniqueCards(
    [
      ...pokemonCardMemory.values()
    ].filter(card =>
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
   * P / PI:
   * local only.
   * No outbound API request.
   */

  if (
    searchValue.length <
    MIN_SEARCH_LENGTH
  ) {
    return localPokemonMatches(
      searchValue
    );
  }


  /*
   * Cancel previous keystroke search.
   */

  if (
    activeAbortController
  ) {
    activeAbortController.abort();
  }

  const controller =
    new AbortController();

  activeAbortController =
    controller;


  try {

    /*
     * IMPORTANT:
     *
     * Only one page is requested for autocomplete.
     *
     * The previous implementation could attempt
     * 100 pages for every 3-character search.
     */

    const apiCards =
      await pokemonTcgRequest(
        `name:${escapePokemonQuery(searchValue)}*`,
        1,
        controller.signal,
        AUTOCOMPLETE_PAGE_SIZE
      );


    return uniqueCards([
      ...apiCards,
      ...pokemonCardMemory.values()
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

    if (
      error?.name ===
      'AbortError'
    ) {
      return localPokemonMatches(
        searchValue
      );
    }

    console.error(
      'Pokémon lookup failed:',
      error
    );

    return localPokemonMatches(
      searchValue
    );

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
      ].filter(card =>
        String(
          card?.set?.name || ''
        )
          .toLowerCase()
          .includes(
            searchValue
          )
      )
    );


  if (
    searchValue.length <
    MIN_SEARCH_LENGTH
  ) {
    return localMatches();
  }


  try {

    const apiCards =
      await pokemonTcgRequest(
        `set.name:${escapePokemonQuery(searchValue)}*`,
        1,
        null,
        AUTOCOMPLETE_PAGE_SIZE
      );


    return uniqueCards([
      ...apiCards,
      ...pokemonCardMemory.values()
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


async function searchByCard(
  value
) {

  const q =
    String(value || '')
      .trim();

  if (!q) {
    return [];
  }


  const clean =
    q.replace(
      /^#/,
      ''
    );


  const numberMatch =
    clean.match(
      /^([0-9]+)(?:\/[0-9]+)?$/
    );


  if (numberMatch) {

    const number =
      numberMatch[1];

    try {

      const apiResults =
        await pokemonTcgRequest(
          `number:${number}`,
          1,
          null,
          AUTOCOMPLETE_PAGE_SIZE
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
        ].filter(card =>
          String(
            card?.number || ''
          )
            .split('/')[0] ===
          number
        )
      );
    }
  }


  const embeddedNumber =
    clean.match(
      /#?([0-9]+)(?:\/[0-9]+)?$/
    );


  const namePart =
    embeddedNumber
      ? clean.slice(
          0,
          embeddedNumber.index
        ).trim()
      : clean;


  const normalizedName =
    namePart.toLowerCase();


  const localMatches = () => {

    let results =
      [
        ...pokemonCardMemory.values()
      ].filter(card =>
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
        ? await pokemonTcgRequest(
            `name:${escapePokemonQuery(normalizedName)}*`,
            1,
            null,
            AUTOCOMPLETE_PAGE_SIZE
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
    ].filter(card =>
      getPokemonCardVariants(
        card
      ).some(v =>
        v.toLowerCase()
          .includes(q)
      )
    )
  );
}


async function searchPokemonCards(
  search
) {

  if (
    typeof search ===
    'string'
  ) {

    const value =
      search.trim();

    return value
      ? searchByPokemon(value)
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


  if (pokemon) {
    results =
      await searchByPokemon(
        pokemon
      );
  }


  if (set) {

    const setResults =
      await searchBySet(
        set
      );

    results =
      results === null
        ? setResults
        : results.filter(
            r =>
              setResults.some(
                o =>
                  o.id === r.id
              )
          );
  }


  if (card) {

    const cardResults =
      await searchByCard(
        card
      );

    results =
      results === null
        ? cardResults
        : results.filter(
            r =>
              cardResults.some(
                o =>
                  o.id === r.id
              )
          );
  }


  if (results === null) {
    results = [
      ...pokemonCardMemory.values()
    ];
  }


  if (variant) {

    results =
      results.filter(
        r =>
          cardHasVariant(
            r,
            variant
          )
      );
  }


  return uniqueCards(
    results
  );
}


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

  return searchPokemonCards(
    query
  );
}


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

      const setCompare =
        (
          a?.set?.name || ''
        ).localeCompare(
          b?.set?.name || ''
        );

      if (
        setCompare !== 0
      ) {
        return setCompare;
      }

      return (
        a?.number || ''
      ).localeCompare(
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
    .forEach(card =>
      getPokemonCardVariants(
        card
      ).forEach(v =>
        variants.add(v)
      )
    );

  return [
    ...variants
  ].sort(
    (a, b) =>
      a.localeCompare(b)
  );
}


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
    ).trim();

  const variant =
    String(
      criteria?.variant || ''
    ).trim();


  return source.filter(
    record => {

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


      if (
        set &&
        !String(
          record?.set?.name || ''
        )
          .toLowerCase()
          .includes(
            set
          )
      ) {
        return false;
      }


      if (card) {

        const cardText =
          [
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
    }
  );
}


function clearPokemonTcgCache() {

  if (activeAbortController) {
    activeAbortController.abort();
    activeAbortController = null;
  }

  pokemonCardSearchCache.clear();
  pokemonCardMemory.clear();
}


// Global Exposure

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
