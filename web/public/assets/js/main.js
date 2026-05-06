import { login as fbLogin, logout as fbLogout, onAuth, ensureProjectInitialized,
         listAccounts, getAccount, setAccount, listTransactions,
         upsertTransaction, upsertTransactionsBatch,
         getConfig, setConfig,
         listObservations, addObservation } from "./firebase-client.js";
import { parseXls, inspectXls } from "./xls-parsers.js";
import { computeAlias } from "./alias-resolver.js";
import { CURRENCIES, DEFAULT_CURRENCY, formatCurrency, formatCurrencyShort, localeFor } from "./currencies.js";

window.__fb = { fbLogin, fbLogout, onAuth, ensureProjectInitialized,
                listAccounts, getAccount, setAccount, listTransactions,
                upsertTransaction, upsertTransactionsBatch,
                getConfig, setConfig, parseXls, inspectXls, computeAlias,
                listObservations, addObservation,
                CURRENCIES, DEFAULT_CURRENCY, formatCurrency, formatCurrencyShort, localeFor };
