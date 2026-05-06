// Parsers de XLS en el navegador. Requiere SheetJS cargado globalmente como XLSX.
//
// Dos formatos soportados (CaixaBank):
//   - Cuenta corriente (build_transactions.py):
//       fila 4 cabecera con "F. Operación" en columna E, 24 columnas.
//   - Tarjeta de crédito (build_credit_card.py):
//       cabecera "Fecha | Establecimiento/concepto | Estado | Importe".
//
// Ambos producen el mismo contrato: { payload, accountId }
// payload = { version, account, taxonomy, transactions }

import { TAXONOMY, categorize, assignIds, normalizeText, slug } from "./common.js";
import { computeAlias } from "./alias-resolver.js";

const BANK_CODES = {
  "2100": "CaixaBank",
  "0049": "Santander",
  "0081": "Banco Sabadell",
  "0182": "BBVA",
  "0128": "Bankinter",
  "0073": "Openbank",
  "1491": "Triodos",
  "1583": "Self Bank",
  "2038": "Bankia",
  "3058": "Cajamar",
};

// ---- utilidades comunes ----
function readWorkbookFromArrayBuffer(buf) {
  return XLSX.read(buf, { type: "array", cellDates: false, raw: true });
}

function sheetToMatrix(sheet) {
  // Devuelve matriz de filas con valores raw (strings y números).
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: true });
}

function parseDateDMY(v) {
  if (!v) return null;
  if (typeof v !== "string") return null;
  const parts = v.trim().split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

// ===== Parser 1: cuenta corriente CaixaBank =====

function findHeaderRow(matrix) {
  for (let i = 0; i < matrix.length; i++) {
    const row = matrix[i];
    if (row && row[4] === "F. Operación") return i;
  }
  return -1;
}

const CARD_PATTERN = /^Fecha de operación:\s*\d{2}-\d{2}-\d{4}\s+(.+)$/i;

function parseMerchantAccount(cc1, cc9, isIncome) {
  cc1 = (cc1 || "").trim();
  cc9 = (cc9 || "").trim();
  const m = cc1.match(CARD_PATTERN);
  if (m) return normalizeText(m[1]);
  const [primary, secondary] = isIncome ? [cc1, cc9] : [cc9, cc1];
  if (primary) return normalizeText(primary);
  if (secondary) return normalizeText(secondary);
  return "";
}

const RAW_FIELDS_ACCOUNT = [
  ["Cuenta", 1],
  ["Oficina", 2],
  ["Divisa", 3],
  ["F. Valor", 5],
  ["Saldo tras operación", 8],
  ["Concepto común", 10],
  ["Concepto propio", 11],
  ["Referencia 1", 12],
  ["Referencia 2", 13],
  ["Contraparte", 22],
  ["Titular / nombre propio", 14],
  ["Info extra 1", 15],
  ["Info extra 2", 16],
  ["Descripción / nota", 17],
  ["Info extra 3", 18],
  ["Info extra 4", 19],
  ["Info extra 5", 20],
  ["Info extra 6", 21],
  ["Info extra 7", 23],
];

function buildRawAccount(row) {
  const out = [];
  for (const [label, idx] of RAW_FIELDS_ACCOUNT) {
    let v = row[idx];
    if (typeof v === "string") v = v.replace(/\s+/g, " ").trim();
    if (v === "" || v === 0 || v == null) continue;
    out.push({ k: label, v: typeof v === "string" ? v : Number(v.toFixed ? v.toFixed(2) : v) });
  }
  return out;
}

function accountIdFromCuenta(cuentaStr) {
  const digits = (cuentaStr || "").replace(/\D/g, "");
  return digits.slice(-10) || "unknown";
}

function buildAccountInfoFromCuenta(cuentaStr) {
  const digits = (cuentaStr || "").replace(/\D/g, "");
  const bank = BANK_CODES[digits.slice(0, 4)] || "";
  return {
    iban: (cuentaStr || "").trim(),
    bank,
    alias: "",
    kind: "account",
  };
}

async function parseAccount(matrix, aliasRules, userRules) {
  const headerIdx = findHeaderRow(matrix);
  if (headerIdx < 0) throw new Error("No se encontró cabecera 'F. Operación'");
  const parsed = [];
  for (let i = headerIdx + 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.every(c => c === "" || c == null)) continue;
    const ingreso = row[6];
    const gasto = row[7];
    const amountRaw = (typeof gasto === "number" && gasto !== 0)
      ? gasto
      : ((typeof ingreso === "number" && ingreso !== 0) ? ingreso : 0);
    if (!amountRaw) continue;
    const d = parseDateDMY(row[4]);
    if (!d) continue;
    const isIncome = typeof ingreso === "number" && ingreso !== 0;
    const m = parseMerchantAccount(row[14], row[22], isIncome);
    const c = (row[17] || "").toString().trim();
    const [cat, sub] = categorize(m, isIncome, userRules);
    const tx = {
      d,
      a: Math.round(Math.abs(amountRaw) * 100) / 100,
      dir: isIncome ? "in" : "out",
      m, c, cat, sub,
      raw: buildRawAccount(row),
    };
    tx.alias = computeAlias(tx, aliasRules);
    tx.alias_manual = false;
    parsed.push(tx);
  }
  parsed.sort((a, b) => a.d.localeCompare(b.d));
  assignIds(parsed);

  // Extraer cuenta del primer raw para derivar IDs
  let cuentaStr = "";
  for (const kv of (parsed[0]?.raw || [])) {
    if (kv.k === "Cuenta") { cuentaStr = kv.v; break; }
  }
  const accountId = accountIdFromCuenta(cuentaStr);
  const account = buildAccountInfoFromCuenta(cuentaStr);

  return { accountId, account, transactions: parsed };
}

// ===== Parser 2: tarjeta de crédito CaixaBank =====

const CC_HEADER = ["Fecha", "Establecimiento/concepto", "Estado", "Importe"];

function isCreditCard(matrix) {
  if (!matrix.length || !matrix[0]) return false;
  return CC_HEADER.every((h, i) => (matrix[0][i] || "").toString().trim() === h);
}

const RAW_FIELDS_CC = [
  ["Fecha", 0],
  ["Establecimiento/concepto", 1],
  ["Estado", 2],
  ["Importe", 3],
];

function buildRawCC(row) {
  const out = [];
  for (const [label, idx] of RAW_FIELDS_CC) {
    let v = row[idx];
    if (typeof v === "string") v = v.replace(/\s+/g, " ").trim();
    if (v === "" || v == null) continue;
    out.push({ k: label, v: typeof v === "string" ? v : Number(Number(v).toFixed(2)) });
  }
  return out;
}

async function parseCreditCard(matrix, last4, aliasRules, userRules) {
  if (!last4 || !/^\d{4}$/.test(last4)) {
    throw new Error("Se requieren 4 dígitos (últimos 4 de la tarjeta).");
  }
  const parsed = [];
  for (let i = 1; i < matrix.length; i++) {
    const row = matrix[i];
    if (!row || row.every(c => c === "" || c == null)) continue;
    const d = parseDateDMY(row[0]);
    const imp = row[3];
    if (!d || typeof imp !== "number" || imp === 0) continue;
    const isIncome = imp < 0;
    const a = Math.round(Math.abs(imp) * 100) / 100;
    const m = normalizeText(String(row[1] || ""));
    const [cat, sub] = categorize(m, isIncome, userRules);
    const tx = {
      d, a,
      dir: isIncome ? "in" : "out",
      m, c: "", cat, sub,
      raw: buildRawCC(row),
    };
    tx.alias = computeAlias(tx, aliasRules);
    tx.alias_manual = false;
    parsed.push(tx);
  }
  parsed.sort((a, b) => a.d.localeCompare(b.d));
  assignIds(parsed);

  const accountId = `cc-${last4}`;
  const account = {
    iban: "",
    bank: "CaixaBank",
    alias: "",
    kind: "credit_card",
    last4,
    card_type: "",
    holder: "",
  };
  return { accountId, account, transactions: parsed };
}

// ===== Dispatcher =====

export async function parseXls(file, opts = {}) {
  const { last4, aliasRules = [], userRules = { merchants: {}, patterns: [] } } = opts;
  const buf = await file.arrayBuffer();
  const wb = readWorkbookFromArrayBuffer(buf);
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const matrix = sheetToMatrix(sheet);

  if (isCreditCard(matrix)) {
    if (!last4) {
      const err = new Error("Es un extracto de tarjeta de crédito: se necesitan los últimos 4 dígitos.");
      err.code = "NEEDS_LAST4";
      throw err;
    }
    return parseCreditCard(matrix, last4, aliasRules, userRules);
  }
  // fallback: cuenta corriente
  return parseAccount(matrix, aliasRules, userRules);
}
