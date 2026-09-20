const decamelizeRegexp = /([a-z\d])([A-Z])/g;

/**
 * Split `value` into lowercase tokens, treating camelCase boundaries,
 * hyphens, and underscores as separators. The foundation other helpers
 * (`kebabCase`, `camelize`, display-name derivation) build on.
 *
 * @example
 *   normalizeCase("FooBarBaz")     // ["foo", "bar", "baz"]
 *   normalizeCase("foo_bar-baz")   // ["foo", "bar", "baz"]
 */
export function normalizeCase(value: string): string[] {
  return value.replace(decamelizeRegexp, "$1_$2").toLowerCase().split(/-|_/g);
}

const uncountables: Set<string> = new Set([
  "accommodation",
  "adulthood",
  "advertising",
  "advice",
  "aggression",
  "aid",
  "air",
  "aircraft",
  "alcohol",
  "anger",
  "applause",
  "arithmetic",
  "assistance",
  "athletics",

  "bacon",
  "baggage",
  "beef",
  "biology",
  "blood",
  "botany",
  "bread",
  "butter",

  "carbon",
  "cardboard",
  "cash",
  "chalk",
  "chaos",
  "chess",
  "crossroads",
  "countryside",

  "dancing",
  "deer",
  "dignity",
  "dirt",
  "dust",

  "economics",
  "education",
  "electricity",
  "engineering",
  "enjoyment",
  "envy",
  "equipment",
  "ethics",
  "evidence",
  "evolution",

  "fame",
  "fiction",
  "flour",
  "flu",
  "food",
  "fuel",
  "fun",
  "furniture",

  "gallows",
  "garbage",
  "garlic",
  "genetics",
  "gold",
  "golf",
  "gossip",
  "grammar",
  "gratitude",
  "grief",
  "guilt",
  "gymnastics",

  "happiness",
  "hardware",
  "harm",
  "hate",
  "hatred",
  "health",
  "heat",
  "help",
  "homework",
  "honesty",
  "honey",
  "hospitality",
  "housework",
  "humour",
  "hunger",
  "hydrogen",

  "ice",
  "importance",
  "inflation",
  "information",
  "innocence",
  "iron",
  "irony",

  "jam",
  "jewelry",
  "judo",

  "karate",
  "knowledge",

  "lack",
  "laughter",
  "lava",
  "leather",
  "leisure",
  "lightning",
  "linguine",
  "linguini",
  "linguistics",
  "literature",
  "litter",
  "livestock",
  "logic",
  "loneliness",
  "luck",
  "luggage",

  "macaroni",
  "machinery",
  "magic",
  "management",
  "mankind",
  "marble",
  "mathematics",
  "mayonnaise",
  "measles",
  "methane",
  "milk",
  "money",
  "mud",
  "music",
  "mumps",

  "nature",
  "news",
  "nitrogen",
  "nonsense",
  "nurture",
  "nutrition",

  "obedience",
  "obesity",
  "oxygen",

  "pasta",
  "patience",
  "physics",
  "poetry",
  "pollution",
  "poverty",
  "pride",
  "psychology",
  "publicity",
  "punctuation",

  "quartz",

  "racism",
  "relaxation",
  "reliability",
  "research",
  "respect",
  "revenge",
  "rice",
  "rubbish",
  "rum",

  "safety",
  "scenery",
  "seafood",
  "seaside",
  "series",
  "shame",
  "sheep",
  "shopping",
  "sleep",
  "smoke",
  "smoking",
  "snow",
  "soap",
  "software",
  "soil",
  "spaghetti",
  "species",
  "steam",
  "stuff",
  "stupidity",
  "sunshine",
  "symmetry",

  "tennis",
  "thirst",
  "thunder",
  "timber",
  "traffic",
  "transportation",
  "trust",

  "underwear",
  "unemployment",
  "unity",

  "validity",
  "veal",
  "vegetation",
  "vegetarianism",
  "vengeance",
  "violence",
  "vitality",

  "warmth",
  "wealth",
  "weather",
  "welfare",
  "wheat",
  "wildlife",
  "wisdom",
  "yoga",

  "zinc",
  "zoology",
]);

const specialCases = new Map<string, string>();

specialCases.set("ox", "oxen");
specialCases.set("man", "men");
specialCases.set("woman", "women");
specialCases.set("die", "dice");
specialCases.set("yes", "yeses");
specialCases.set("foot", "feet");
specialCases.set("eave", "eaves");
specialCases.set("goose", "geese");
specialCases.set("tooth", "teeth");
specialCases.set("quiz", "quizzes");

const rules: [RegExp, string][] = [
  [/(\w*)s$/, "s"],
  [/(\w*([^aeiou]ese))$/, ""],
  [/(\w*(ax|test))is$/, "es"],
  [/(\w*(alias|[^aou]us|tlas|gas|ris))$/, "es"],
  [/(\w*(ax|test))is$/, "s"],
  [/(\w*([^l]ias|[aeiou]las|[emjzr]as|[iu]am))$/, ""],
  [
    /(\w*(alumn|syllab|octop|vir|radi|nucle|fung|cact|stimul|termin|bacill|foc|uter|loc|strat))(?:us|i)$/,
    "i",
  ],
  [/(\w*(alumn|alg|vertebr))(?:a|ae)$/, "ae"],
  [/(\w*(seraph|cherub))(?:im)?$/, "im"],
  [/(\w*(her|at|gr))o$/, "oes"],
  [
    /(\w*(agend|addend|millenni|dat|extrem|bacteri|desiderat|strat|candelabr|errat|ov|symposi|curricul|automat|quor))(?:a|um)$/,
    "a",
  ],
  [
    /(\w*(apheli|hyperbat|periheli|asyndet|noumen|phenomen|criteri|organ|prolegomen|hedr|automat))(?:a|on)$/,
    "a",
  ],
  [/(\w*)sis$/, "ses"],
  [/(\w*(kni|wi|li))fe$/, "ves"],
  [/(\w*(ar|l|ea|eo|oa|hoo))f$/, "ves"],
  [/(\w*([^aeiouy]|qu))y$/, "ies"],
  [/(\w*([^ch][ieo][ln]))ey$/, "ies"],
  [/(\w*(x|ch|ss|sh|zz)es)$/, ""],
  [/(\w*(x|ch|ss|sh|zz))$/, "es"],
  [/(\w*(matr|cod|mur|sil|vert|ind|append))(?:ix|ex)$/, "ices"],
  [/(\w*(sql|l)(?:ice|ouse))$/, "ice"],
  [/(\w*(pe)(?:rson|ople))$/, "ople"],
  [/(\w*(child))(?:ren)?$/, "ren"],
  [/(\w*eaux)$/, ""],
];

rules.reverse();

function pluralizeWord(word: string): string {
  if (uncountables.has(word)) {
    return word;
  }
  if (specialCases.has(word)) {
    return specialCases.get(word)!;
  }
  for (const [rule, replace] of rules) {
    const exec = word.match(rule);
    if (exec?.[1]) {
      return exec[1] + replace;
    }
  }
  return `${word}s`;
}

/**
 * Pluralize the last word in `value`, preserving any leading hyphenated,
 * snake-cased, or whitespace-separated prefix.
 *
 * @example
 *   pluralize("person") // "people"
 *   pluralize("invoice_item") // "invoice_items"
 */
export function pluralize(value: string): string {
  const splitValue = value.split(/-|_|\s/g);
  const lastWord = splitValue[splitValue.length - 1];
  return (
    value.substring(0, value.length - lastWord.length) + pluralizeWord(lastWord)
  );
}

/**
 * Convert `value` to kebab-case (e.g. `"user_profile" -> "user-profile"`).
 * Splits on whitespace, underscores, hyphens, and camelCase boundaries.
 */
export function kebabCase(value: string) {
  return normalizeCase(value).join("-");
}

/** Uppercase the first character of `s`; leaves the rest untouched. */
export function upcaseFirst(s: string): string {
  if (s.length === 0) {
    return s;
  }
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Lowercase the first character of `s`; leaves the rest untouched. */
export function downcaseFirst(s: string): string {
  if (s.length === 0) {
    return s;
  }
  return s.charAt(0).toLowerCase() + s.slice(1);
}

/**
 * Convert `s` to lowerCamelCase. Splits on whitespace, underscores,
 * hyphens, and camelCase boundaries, then re-joins with subsequent words
 * upper-cased.
 *
 * @example
 *   camelize("user_profile") // "userProfile"
 */
export function camelize(s: string) {
  return normalizeCase(s)
    .map((v, i) => (i === 0 ? v : upcaseFirst(v)))
    .join("");
}

// Create reverse special cases for singularization
const reverseSpecialCases = new Map<string, string>();
for (const [singular, plural] of specialCases.entries()) {
  reverseSpecialCases.set(plural, singular);
}

// IMPORTANT: More general rules first, more specific ones last, so that after reversal,
// the specific rules run first and the general fallback runs last.
const singularRules: [RegExp, string][] = [
  // FINAL FALLBACK: remove trailing "s"
  [/(\w*)s$/, "$1"],

  // From "eaux" unchanged, just a placeholder to ensure correct order
  [/(\w*(eaux))$/, "$1"],

  // "oes" -> "o"
  [/(\w*(her|at|gr))oes$/, "$1o"],

  // From Latin/Greek plurals: "a" -> "um"
  [
    /(\w*(agend|addend|millenni|dat|extrem|bacteri|desiderat|strat|candelabr|errat|ov|symposi|curricul|automat|quor))a$/,
    "$1um",
  ],
  // "a" -> "on"
  [
    /(\w*(apheli|hyperbat|periheli|asyndet|noumen|phenomen|criteri|organ|prolegomen|hedr|automat))a$/,
    "$1on",
  ],

  // "men" -> "man"
  [/(men)$/, "man"],
  // "women" -> "woman"
  [/(women)$/, "woman"],
  // "oxen" -> "ox"
  [/(ox)en$/, "$1"],

  // "seraphim", "cherubim" -> "seraph", "cherub"
  [/(\w*(seraph|cherub))im$/, "$1"],

  // "ae" -> "a"
  [/(\w*(alumn|alg|vertebr))ae$/, "$1a"],

  // Special "ey" forms: "ies" -> "ey"
  [/(\w*([^ch][ieo][ln]))ies$/, "$1ey"],

  // "ves" -> "fe"
  [/(?:([^f])ves)$/, "$1fe"],

  // "ses" -> "sis"
  [/(\w*)ses$/, "$1sis"],

  // "(kni|wi|li)ves" -> "fe"
  [/(\w*(kni|wi|li))ves$/, "$1fe"],

  // "quizzes" -> "quiz"
  [/(quiz)zes$/, "$1"],

  // "children" -> "child"
  [/(\w*(child))ren$/, "$1"],

  // "people" -> "person"
  [/(\w*(pe))ople$/, "$1rson"],

  // "mice" / "lice" -> "mouse" / "louse"
  [/(\w*(sql|l))ice$/, "$1ouse"],

  // "ices" -> "ix"
  [/(\w*(matr|cod|mur|sil|vert|ind|append))ices$/, "$1ix"],

  // (x|ch|ss|sh|zz)es -> (x|ch|ss|sh|zz)
  [/(\w*(x|ch|ss|sh|zz))es$/, "$1"],

  // "([^aeiou])ies" -> "y"
  [/(\w*[^aeiou])ies$/, "$1y"],

  // Special words
  [/(teeth)$/, "tooth"],
  [/(geese)$/, "goose"],
  [/(eaves)$/, "eave"],
  [/(feet)$/, "foot"],
  [/(yeses)$/, "yes"],
  [/(dice)$/, "die"],

  // Remove "es" from certain endings
  [/(\w*(alias|[^aou]us|tlas|gas|ris))es$/, "$1"],

  // "(ax|test)es" -> "is"
  [/(\w*(ax|test))es$/, "$1is"],
  // "(ax|test)s" -> "is"
  [/(\w*(ax|test))s$/, "$1is"],

  // "Chinese" etc. stays unchanged (just a placeholder to ensure order)
  [/\w*([^aeiou]ese)$/, "$1ese"],
];

// Reverse the singularRules so the most specific ones run first:
singularRules.reverse();

function singularizeWord(word: string): string {
  if (uncountables.has(word)) {
    return word;
  }
  if (reverseSpecialCases.has(word)) {
    return reverseSpecialCases.get(word)!;
  }
  for (const [rule, replace] of singularRules) {
    if (rule.test(word)) {
      return word.replace(rule, replace);
    }
  }
  return word;
}

/**
 * Singularize the last word in `value`, preserving any leading prefix.
 * Inverse of {@link pluralize}.
 *
 * @example
 *   singularize("people") // "person"
 *   singularize("invoice_items") // "invoice_item"
 */
export function singularize(value: string): string {
  const splitValue = value.split(/-|_|\s/g);
  const lastWord = splitValue[splitValue.length - 1];
  return (
    value.substring(0, value.length - lastWord.length) +
    singularizeWord(lastWord)
  );
}
