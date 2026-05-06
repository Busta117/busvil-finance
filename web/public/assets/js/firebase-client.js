// Firebase client wrapper. Todas las paths cuelgan de projects/{PROJECT_ID}/...
// así que si en el futuro se añaden más proyectos cohabitan sin colisión.

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.0/firebase-app.js";
import {
  getAuth,
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-auth.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  collection,
  getDocs,
  writeBatch,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.13.0/firebase-firestore.js";

import { firebaseConfig, PROJECT_ID } from "./config.local.js";
export { firebaseConfig, PROJECT_ID };

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// ---- Auth ----
export async function login(email, password) {
  const cred = await signInWithEmailAndPassword(auth, email, password);
  return cred.user;
}
export async function logout() {
  await signOut(auth);
}
export function onAuth(callback) {
  return onAuthStateChanged(auth, callback);
}

// ---- Paths ----
const projectPath = () => `projects/${PROJECT_ID}`;
const accountsPath = () => `${projectPath()}/accounts`;
const accountPath = (accountId) => `${accountsPath()}/${accountId}`;
const txCollPath = (accountId) => `${accountPath(accountId)}/transactions`;
const configPath = (name) => `${projectPath()}/config/${name}`;

// ---- Project bootstrap ----
// Asegura que projects/{PROJECT_ID} existe con owner = uid actual.
// Si el doc no existe, lo crea (las rules permiten create si apunta al uid autenticado).
export async function ensureProjectInitialized() {
  if (!auth.currentUser) throw new Error("No autenticado");
  const ref = doc(db, projectPath());
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      owner: auth.currentUser.uid,
      createdAt: Date.now(),
      name: "Busta Finance",
    });
  }
}

// ---- Accounts ----
export async function listAccounts() {
  const snap = await getDocs(collection(db, accountsPath()));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getAccount(accountId) {
  const snap = await getDoc(doc(db, accountPath(accountId)));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function setAccount(accountId, accountData) {
  await setDoc(doc(db, accountPath(accountId)), accountData, { merge: true });
}

// ---- Transactions ----
export async function listTransactions(accountId) {
  const snap = await getDocs(collection(db, txCollPath(accountId)));
  return snap.docs.map(d => d.data());
}

export async function upsertTransaction(accountId, tx) {
  // El id de la tx es el field `id`; lo usamos como id del doc para dedup.
  await setDoc(doc(db, txCollPath(accountId), tx.id), tx);
}

// Escribe muchas transacciones usando batched writes (500 por batch).
export async function upsertTransactionsBatch(accountId, txs) {
  const BATCH_SIZE = 400;
  let written = 0;
  for (let i = 0; i < txs.length; i += BATCH_SIZE) {
    const chunk = txs.slice(i, i + BATCH_SIZE);
    const batch = writeBatch(db);
    for (const tx of chunk) {
      batch.set(doc(db, txCollPath(accountId), tx.id), tx);
    }
    await batch.commit();
    written += chunk.length;
  }
  return written;
}

export async function deleteAccount(accountId) {
  // Borrar todas las transacciones primero
  const txSnap = await getDocs(collection(db, txCollPath(accountId)));
  const batch = writeBatch(db);
  txSnap.forEach(d => batch.delete(d.ref));
  batch.delete(doc(db, accountPath(accountId)));
  await batch.commit();
}

// ---- Config (rules, alias, suggestions) ----
// Usamos 3 docs en projects/{PROJECT_ID}/config/
export async function getConfig(name) {
  const snap = await getDoc(doc(db, configPath(name)));
  return snap.exists() ? snap.data() : null;
}

export async function setConfig(name, data) {
  await setDoc(doc(db, configPath(name)), data);
}

// ---- Observations (aprendizaje con validación por umbral) ----
const obsPath = () => `${projectPath()}/observations`;

export async function listObservations() {
  const snap = await getDocs(collection(db, obsPath()));
  return snap.docs.map(d => ({ _docId: d.id, ...d.data() }));
}

export async function addObservation(docId, obs) {
  await setDoc(doc(db, obsPath(), docId), obs);
}
