// Puerto JS de alias_resolver.py. Mismo contrato:
//   computeAlias(tx, rules) -> string

const CARD_PREFIX = /^\d{8,}[A-Z]{3}\s+/i;
const SEPA_PREFIX = /^D-[0-9A-Z]{10,}\s+/i;
const NUMID_PREFIX = /^\d{6,}\s+/i;
const OWNER_TAIL_1 = /\s*SANTIAGO\s+BUSTAMANTE\s+GARCIA.*$/i;
const OWNER_TAIL_2 = /\s*BUSTAMANTE\s+GARCIA\s+SANTIAGO.*$/i;
const NOTPROVIDE = /\s*NOTPROVIDE\s*$/i;
const WS = /\s+/g;

const OWN_NAME_PATTERNS = [
  /^SANTIAGO\s+BUSTAMANTE/i,
  /^BUSTAMANTE\s+GARCIA\s+SANTIAGO/i,
];

function isOwnName(s) {
  s = (s || "").trim();
  return OWN_NAME_PATTERNS.some(p => p.test(s));
}

function cleanup(text) {
  if (!text) return "";
  let s = text.replace(WS, " ").trim();
  s = s.replace(NOTPROVIDE, "");
  s = s.replace(SEPA_PREFIX, "");
  s = s.replace(NUMID_PREFIX, "");
  s = s.replace(CARD_PREFIX, "");
  s = s.replace(OWNER_TAIL_1, "");
  s = s.replace(OWNER_TAIL_2, "");
  return s.trim();
}

const SMALL = new Set(["de","la","el","y","&","del","los","las","i","a","en","por"]);
const KEEP_UPPER = new Set([
  "SL","SA","BCN","CBA","SRL","SAS","SLU","SCP","LLC",
  "S.L.","S.A.","BBVA","IBKR","TGSS","MYCARD","VISA",
  "TMB","CCO","HM","DS","SP","SQ"
]);

function titlecase(text) {
  if (!text) return text;
  const words = text.split(" ");
  return words.map((w, i) => {
    const wu = w.replace(/[,.;:()]/g, "").toUpperCase();
    if (KEEP_UPPER.has(wu)) return w.toUpperCase();
    if (SMALL.has(w.toLowerCase()) && i !== 0) return w.toLowerCase();
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}

function collectText(tx) {
  const parts = [tx.m || "", tx.c || ""];
  for (const kv of (tx.raw || [])) {
    const v = kv.v;
    if (typeof v === "string") parts.push(v);
  }
  return parts.join(" ").toUpperCase();
}

function fallbackAlias(tx) {
  const mRaw = tx.m || "";
  const m = cleanup(mRaw);
  let titular = "";
  let contraparte = "";
  for (const kv of (tx.raw || [])) {
    const v = String(kv.v || "");
    if (kv.k === "Titular / nombre propio") titular = v;
    else if (kv.k === "Contraparte") contraparte = v;
  }
  const tClean = cleanup(titular);
  const cClean = cleanup(contraparte);

  if (isOwnName(mRaw) || isOwnName(m)) {
    if (cClean && !isOwnName(cClean)) return titlecase(cClean);
    if (tClean && !isOwnName(tClean)) return titlecase(tClean);
    return "Auto-transferencia";
  }
  if (m && !isOwnName(m)) return titlecase(m);
  if (cClean && !isOwnName(cClean)) return titlecase(cClean);
  if (tClean && !isOwnName(tClean)) return titlecase(tClean);
  return "Auto-transferencia";
}

export function computeAlias(tx, rules) {
  if (tx.alias_manual && tx.alias) return tx.alias;
  const haystack = collectText(tx);
  for (const rule of (rules || [])) {
    for (const p of (rule.patterns || [])) {
      if (haystack.includes(p.toUpperCase())) return rule.alias || "";
    }
  }
  return fallbackAlias(tx);
}
