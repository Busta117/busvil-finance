// Puerto JS de common.py.
// Taxonomía, reglas base de categorización, utilidades de id/slug/normalize.

export const TAXONOMY = {
  "Transfers": ["Internal Transfer", "Other Transfer", "Card Payment"],
  "Income": ["Salary", "Other Income", "Bonus"],
  "Shopping": ["Fashion & Clothing", "Sports", "Pets", "Electronics & Tech", "Home & Garden", "Beauty & Personal Care", "Gifts"],
  "Food & Drink": ["Cafes & Restaurants", "Supermarket", "Delivery", "Bakery"],
  "Health & Wellness": ["Pharmacy", "Medical", "Gym & Fitness", "Vet"],
  "Leisure": ["Entertainment", "Travel & Hotels", "Activities", "Tickets & Events"],
  "Transport": ["Public Transport", "Taxi & Rideshare", "Tolls & Parking", "Fuel", "Car Rental", "Trains & Flights"],
  "Housing": ["Rent", "Utilities", "Maintenance", "Community Fees"],
  "Subscriptions": ["Streaming", "Software"],
  "Investments": ["Brokerage"],
  "Personal": ["Family", "Friends"],
  "Other": ["Other"],
};

// Reglas base, igual que common.py RULES
export const RULES = [
  [["EVINOVA SPAIN"], "Income", "Salary"],
  [["BUSVIL"], "Income", "Other Income"],
  [["T.G.S.S.", "ABONO CAMPAÑA"], "Income", "Other Income"],
  [["IBKR", "Interactive Brokers"], "Investments", "Brokerage"],
  [["AJUSTE TARJETA", "MYCARD", "AVANCE DE PAGO"], "Transfers", "Card Payment"],
  [["06700051CTF"], "Transfers", "Internal Transfer"],
  [["VETSTIL", "ANICURA", "BORRELLVET"], "Health & Wellness", "Vet"],
  [["FARMACIA"], "Health & Wellness", "Pharmacy"],
  [["WELLHUB", "GYMPASS"], "Health & Wellness", "Gym & Fitness"],
  [["MERCADONA","ALCAMPO","ALDI","CAPRABO","VERITAS","AMETLLER","DIA 31018","SORLI","RAFI SUPERMARKET"], "Food & Drink", "Supermarket"],
  [["GLOVO"], "Food & Drink", "Delivery"],
  [["FORN","PASTISSERIA","PRIFER CAKE","THE LOAF"], "Food & Drink", "Bakery"],
  [["SANDWICHEZ","STARBUCKS","BREW COFFEE","SAGA COFFEE","MISTER BRAZ","HIDDEN CAFE","HONEST GREENS","KASUALK","TAVERNA","TASMANGO","PEMSA LEISURE","ORIGO BAKERY","GOOD TEA","KINA CHOCOLATES","SUCRE CREMAT","COFFEE BAR","COLIBRI","BUGANVILLA","SLOPPY TUNAS"], "Food & Drink", "Cafes & Restaurants"],
  [["DECATHLON","COREALMIRI","OLYMPIA ESPORTS","PICSIL SPORT","ASICS"], "Shopping", "Sports"],
  [["MISCOTA"], "Shopping", "Pets"],
  [["AMAZON","PCCOM","CCO COMX"], "Shopping", "Electronics & Tech"],
  [["LEROY MERLIN"], "Shopping", "Home & Garden"],
  [["CURAPROX","PERFUMS BEAUTY","THE MAN CAVE","THE PROFESSIONAL"], "Shopping", "Beauty & Personal Care"],
  [["UNIQLO","HM ES","SANDALS","SPHERE BCN","FINCUT","DS COMPLEMENTOS","VENDING ZARAGOZA"], "Shopping", "Fashion & Clothing"],
  [["TMB"], "Transport", "Public Transport"],
  [["UBER","FREENOW","LIME"], "Transport", "Taxi & Rideshare"],
  [["TELPARK","AUTOPISTAS","TUNELSPAN","APARCAMENT"], "Transport", "Tolls & Parking"],
  [["PLENERGY","E.S. AVDA"], "Transport", "Fuel"],
  [["EUROPCAR"], "Transport", "Car Rental"],
  [["RENFE","OUIGO","VUELING AIRLINES","FALCANS"], "Transport", "Trains & Flights"],
  [["AMOVENS"], "Transport", "Taxi & Rideshare"],
  [["Hotel at Booking","AIRBNB","PROAP APARTAMENTS","APARTAMENTS ELS A","ALTEA COMUNIDAD"], "Leisure", "Travel & Hotels"],
  [["GRANDVALIRA","A.P.S. CENTRO GIO","ONE MORE","CARNIVAL","THE HALL"], "Leisure", "Activities"],
  [["TICKETMASTER","TM *Ticketmaster"], "Leisure", "Tickets & Events"],
];

// ---- categorize ----
export function categorize(merchant, isIncome, userRules) {
  const mUpper = (merchant || "").toUpperCase();

  if (userRules && userRules.merchants && userRules.merchants[mUpper]) {
    const [cat, sub] = userRules.merchants[mUpper];
    if (cat !== "Income" || isIncome) return [cat, sub];
  }

  function tryPatterns(rules) {
    for (const [patterns, cat, sub] of rules) {
      if (cat === "Income" && !isIncome) continue;
      for (const p of patterns) {
        if (mUpper.includes(p.toUpperCase())) return [cat, sub];
      }
    }
    return null;
  }

  if (userRules && userRules.patterns) {
    const hit = tryPatterns(userRules.patterns);
    if (hit) return hit;
  }
  const hit = tryPatterns(RULES);
  if (hit) return hit;
  return ["Other", "Other"];
}

// ---- slug ----
export function slug(s) {
  s = (s || "").trim();
  s = s.replace(/[^A-Za-z0-9]+/g, "-");
  return s.replace(/^-+|-+$/g, "") || "unknown";
}

// ---- normalizeText ----
export function normalizeText(s) {
  if (!s) return "";
  s = s.replace(/\s+/g, " ").trim();
  if (s.endsWith(" NOTPROVIDE")) s = s.slice(0, -" NOTPROVIDE".length).trim();
  return s;
}

// ---- assignIds ----
// Asigna id determinístico {date}_{amount}_{slug}_{idx} para dedup.
export function assignIds(transactions) {
  const seen = new Map();
  for (const t of transactions) {
    const base = `${t.d}_${t.a.toFixed(2)}_${slug(t.m)}`;
    const idx = seen.get(base) || 0;
    seen.set(base, idx + 1);
    t.id = `${base}_${idx}`;
  }
  return transactions;
}
