// poketcg.js
const POKEMON_API_URL = 'https://api.pokemontcg.io/v2/cards';

const pokemonCardSearchCache = new Map();

async function pokemonTcgRequest(query) {
  const key = String(query || '').trim().toLowerCase();

  if (!key) return [];

  if (pokemonCardSearchCache.has(key)) {
    return pokemonCardSearchCache.get(key);
  }

  const response = await fetch(
    `${POKEMON_API_URL}?q=${encodeURIComponent(query)}&pageSize=250`
  );

  if (!response.ok) {
    throw new Error(`Pokémon TCG API returned ${response.status}`);
  }

  const result = await response.json();
  const cards = Array.isArray(result.data) ? result.data : [];

  pokemonCardSearchCache.set(key, cards);

  return cards;
}


/*
 * Converts Pokémon TCG API price keys into actual
 * card presentation variants.
 *
 * IMPORTANT:
 * Rarity is deliberately NOT included.
 */
function getPokemonCardVariants(card) {
  const variants = new Set();

  const prices = card?.tcgplayer?.prices || {};

  Object.keys(prices).forEach(key => {
    const k = key.toLowerCase();

    if (k.includes('reverseholo')) {
      variants.add('Reverse Holo');
    } else if (k.includes('holofoil')) {
      variants.add('Holo');
    } else if (k.includes('1stedition')) {
      variants.add('1st Edition');
    } else if (k.includes('normal')) {
      variants.add('Normal');
    }
  });

  /*
   * Some cards do not have TCGplayer price data.
   * Normal is the safest fallback.
   */
  if (!variants.size) {
    variants.add('Normal');
  }

  return [...variants];
}


/*
 * Original compatibility function.
 * Other parts of RapidUp may still call this.
 */
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


/*
 * General-purpose Pokémon TCG lookup.
 *
 * Accepts either:
 *
 *   searchPokemonCards("Pikachu")
 *
 * OR:
 *
 *   searchPokemonCards({
 *     pokemon: "Pikachu"
 *   })
 *
 *   searchPokemonCards({
 *     set: "Base Set"
 *   })
 *
 *   searchPokemonCards({
 *     card: "16"
 *   })
 *
 * This matches the current RapidUp HTML.
 */
async function searchPokemonCards(search) {

  /*
   * Plain text search.
   */
  if (typeof search === 'string') {
    const query = search.trim();

    if (!query) return [];

    const escaped = query.replace(/"/g, '\\"');

    const terms = [
      `name:"${escaped}"`,
      `set.name:"${escaped}"`,
      `types:"${escaped}"`
    ];

    /*
     * Recognize:
     * 16
     * #16
     * 16/165
     * #16/165
     */
    const numberMatch = query
      .replace(/^#/, '')
      .match(/^(\d+)(?:\/\d+)?$/);

    if (numberMatch) {
      terms.push(`number:${numberMatch[1]}`);
    }

    const results = await Promise.all(
      terms.map(term => pokemonTcgRequest(term))
    );

    return uniqueCards(results.flat());
  }


  /*
   * Field-specific search.
   */
  const field = String(search?.field || '').toLowerCase();
  const value = String(search?.value || '').trim();

  if (!value) return [];


  /*
   * Pokémon / Character
   */
  if (field === 'pokemon') {
    const escaped = value.replace(/"/g, '\\"');

    const results = await Promise.all([
      pokemonTcgRequest(`name:"${escaped}"`),
      pokemonTcgRequest(`types:"${escaped}"`)
    ]);

    return uniqueCards(results.flat());
  }


  /*
   * Set
   */
  if (field === 'set') {
    const escaped = value.replace(/"/g, '\\"');

    return uniqueCards(
      await pokemonTcgRequest(`set.name:"${escaped}"`)
    );
  }


  /*
   * Card name OR card number.
   */
  if (field === 'card') {

    const results = [];

    const escaped = value.replace(/"/g, '\\"');

    /*
     * If the seller entered a number:
     *
     * 16
     * #16
     * 16/165
     */
    const numberMatch = value
      .replace(/^#/, '')
      .match(/^(\d+)(?:\/\d+)?$/);

    if (numberMatch) {
      results.push(
        await pokemonTcgRequest(`number:${numberMatch[1]}`)
      );
    } else {

      /*
       * Otherwise search the card name.
       */
      results.push(
        await pokemonTcgRequest(`name:"${escaped}"`)
      );

      /*
       * Also support entries such as:
       *
       * Breloom #16
       * Pikachu 58
       */
      const embeddedNumber = value.match(/#?(\d+)(?:\/\d+)?$/);

      if (embeddedNumber) {
        results.push(
          await pokemonTcgRequest(`number:${embeddedNumber[1]}`)
        );
      }
    }

    return uniqueCards(results.flat());
  }


  /*
   * Variant.
   *
   * Variant is NOT rarity.
   *
   * We retrieve the currently relevant candidate cards and
   * allow the HTML to filter their actual presentation variants.
   */
  if (field === 'variant') {

    /*
     * A variant search cannot be reliably performed by the
     * Pokémon TCG API itself, so search broadly enough to
     * provide candidate records.
     */
    const results = await pokemonTcgRequest('supertype:Pokémon');

    return uniqueCards(
      results.filter(card =>
        getPokemonCardVariants(card).some(variant =>
          variant.toLowerCase().includes(value.toLowerCase())
        )
      )
    );
  }


  /*
   * Generic fallback.
   */
  return searchPokemonCards(value);
}


/*
 * Remove duplicate cards while preserving order.
 */
function uniqueCards(cards) {
  return [
    ...new Map(
      cards
        .filter(Boolean)
        .map(card => [card.id, card])
    ).values()
  ];
}
