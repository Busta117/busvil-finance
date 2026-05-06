import { login as fbLogin, logout as fbLogout, onAuth, ensureProjectInitialized,
         listAccounts, getAccount, setAccount, listTransactions,
         upsertTransaction, upsertTransactionsBatch,
         getConfig, setConfig,
         listObservations, addObservation } from "./firebase-client.js";
import { parseXls } from "./xls-parsers.js";
import { computeAlias } from "./alias-resolver.js";

window.__fb = { fbLogin, fbLogout, onAuth, ensureProjectInitialized,
                listAccounts, getAccount, setAccount, listTransactions,
                upsertTransaction, upsertTransactionsBatch,
                getConfig, setConfig, parseXls, computeAlias,
                listObservations, addObservation };
