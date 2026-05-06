const COLORS = {
  'Transfers': '#73726c',
  'Income': '#1D9E75',
  'Shopping': '#7F77DD',
  'Food & Drink': '#D85A30',
  'Health & Wellness': '#378ADD',
  'Leisure': '#D4537E',
  'Transport': '#BA7517',
  'Housing': '#8B5A2B',
  'Subscriptions': '#2C7E7E',
  'Investments': '#3B6D11',
  'Personal': '#533AB7',
  'Other': '#B4B2A9'
};

const SUB_COLORS = [
  '#7F77DD','#AFA9EC','#CECBF6',
  '#D85A30','#F0997B','#F5C4B3',
  '#1D9E75','#5DCAA5','#9FE1CB',
  '#378ADD','#85B7EB','#B5D4F4',
  '#BA7517','#EF9F27','#FAC775',
  '#D4537E','#ED93B1','#F4C0D1',
  '#533AB7','#AFA9EC',
  '#3B6D11','#97C459',
];

let chart = null;
let currentCat = null;
let filtered = [];
let RAW = [];
let TAXONOMY = {};
let ACCOUNT = {iban:'', bank:'', alias:'', kind:'account', last4:'', card_type:'', holder:''};
let dirty = false;
let currentDataset = null;           // primario: primer dataset activo (compat con edits)
let currentDatasets = new Set();     // conjunto de accountIds activos
let ACCOUNTS_BY_ID = {};             // cache de metadatos de cuentas por id
let ALL_ACCOUNTS = [];               // lista completa (para poblar el popover)
let excludedIds = new Set();
let excludedCats = new Set();
let excludedSubs = new Set();
let currentSub = null;        // subcategoría seleccionada dentro de currentCat
let searchText = '';
let sortMode = 'date-desc';

// -------- Cache UI state en localStorage, por selección de datasets --------
// La key agrupa 1..N accountIds ordenados alfabéticamente.
const UI_STATE_PREFIX = 'busta-ui-state:';
function uiStateKeyFor(idsSet) {
  return [...idsSet].sort().join('|');
}
function saveUiState() {
  if (!currentDatasets || !currentDatasets.size) return;
  const state = {
    from: document.getElementById('date-from')?.value || '',
    to: document.getElementById('date-to')?.value || '',
    cat: currentCat,
    sub: currentSub,
    sortMode,
    preset: activePreset,
  };
  try { localStorage.setItem(UI_STATE_PREFIX + uiStateKeyFor(currentDatasets), JSON.stringify(state)); }
  catch (_) {}
}
function loadUiStateByKey(key) {
  try {
    const raw = localStorage.getItem(UI_STATE_PREFIX + key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}
// Compat: acepta un accountId (1 dataset) o una selección (Set).
function loadUiState(accountIdOrSet) {
  if (accountIdOrSet instanceof Set) return loadUiStateByKey(uiStateKeyFor(accountIdOrSet));
  return loadUiStateByKey(accountIdOrSet);
}

const LAST_DATASETS_KEY = 'busta-last-datasets';
function saveLastSelection() {
  try { localStorage.setItem(LAST_DATASETS_KEY, JSON.stringify([...currentDatasets])); } catch (_) {}
}
function loadLastSelection() {
  try {
    const raw = localStorage.getItem(LAST_DATASETS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) { return null; }
}

function fmt(n) {
  return new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR',maximumFractionDigits:0}).format(n);
}
function fmtFull(n) {
  return new Intl.NumberFormat('es-ES',{style:'currency',currency:'EUR'}).format(n);
}
function fmtDateNatural(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const months = ['ene','feb','mar','abr','may','jun','jul','ago','sept','oct','nov','dic'];
  return `${d} ${months[m-1]} ${y}`;
}

function getFiltered() {
  const from = document.getElementById('date-from').value;
  const to = document.getElementById('date-to').value;
  return RAW.filter(t => t.d >= from && t.d <= to);
}

function isIncluded(t) {
  if (excludedCats.has(t.cat)) return false;
  if (excludedSubs.has(t.cat + '::' + t.sub)) return false;
  if (excludedIds.has(t.id)) return false;
  return true;
}

function groupBy(arr, key) {
  const map = {};
  for (const t of arr) {
    const k = t[key] || 'Unknown';
    if (!map[k]) map[k] = {total:0, count:0, items:[]};
    map[k].total += t.a;
    map[k].count++;
    map[k].items.push(t);
  }
  return map;
}

function render() {
  filtered = getFiltered();
  const included = filtered.filter(isIncluded);
  const outTx = included.filter(t => t.dir === 'out');
  const inTx = included.filter(t => t.dir === 'in');
  const totalOut = outTx.reduce((s,t)=>s+t.a,0);
  const totalIn = inTx.reduce((s,t)=>s+t.a,0);
  const balance = totalIn - totalOut;

  document.getElementById('s-count').textContent = included.length;
  document.getElementById('s-total').textContent = fmt(totalOut);
  document.getElementById('s-income').textContent = fmt(totalIn);
  const balEl = document.getElementById('s-balance');
  balEl.textContent = (balance >= 0 ? '+' : '') + fmt(balance);
  balEl.style.color = balance >= 0 ? 'var(--ok)' : 'var(--err)';
  const from = document.getElementById('date-from').value;
  const to = document.getElementById('date-to').value;
  document.getElementById('s-period').innerHTML =
    fmtDateNatural(from) + '<span class="period-arrow">↓</span>' + fmtDateNatural(to);

  const catsAll = groupBy(filtered, 'cat');
  const donutTotal = included.reduce((s,t)=>s+t.a,0);

  if (currentCat) {
    // Si la cat cacheada ya no aparece en el rango actual, volver a vista raíz.
    if (!catsAll[currentCat] || !catsAll[currentCat].items.length) {
      currentCat = null;
      currentSub = null;
      saveUiState();
      renderCats(catsAll, donutTotal);
      return;
    }
    renderSubcats(currentCat, catsAll[currentCat].items);
  } else {
    renderCats(catsAll, donutTotal);
  }
}

function renderCats(cats, total) {
  const sorted = Object.entries(cats).sort((a,b)=>b[1].total-a[1].total);

  // Chart solo con categorías incluidas (no excluidas) y totales filtrados
  const chartEntries = sorted
    .filter(([name]) => !excludedCats.has(name))
    .map(([name, d]) => {
      const items = d.items.filter(t => !excludedIds.has(t.id) && !excludedSubs.has(t.cat + '::' + t.sub));
      const sub = items.reduce((s,t)=>s+t.a,0);
      return [name, {total: sub, count: items.length, items}];
    })
    .filter(e => e[1].total > 0);
  const labels = chartEntries.map(e=>e[0]);
  const data = chartEntries.map(e=>e[1].total);
  const colors = labels.map(l=>COLORS[l]||'#888');

  updateChart(labels, data, colors, chartEntries);
  document.getElementById('ct-val').textContent = fmt(total);
  document.getElementById('ct-label').textContent = 'Total';
  document.getElementById('dash-title').textContent = 'Movimientos por categoría';
  document.getElementById('dash-sub').textContent = 'Haz clic en una sección para ver subcategorías';
  document.getElementById('hint-text').textContent = 'Clic en sección → subcategorías';
  document.getElementById('breadcrumb').innerHTML = '';

  // Legend muestra TODAS las categorías (incluidas las excluidas, en gris)
  const legendEntries = sorted.map(([name, d]) => [name, d, COLORS[name]||'#888']);
  renderLegend(legendEntries, false);
  renderList(filtered, null, null);
}

function renderSubcats(catName, items) {
  const subs = groupBy(items, 'sub');
  const sorted = Object.entries(subs).sort((a,b)=>b[1].total-a[1].total);

  const chartEntries = sorted
    .filter(([name]) => !excludedSubs.has(catName + '::' + name))
    .map(([name, d]) => {
      const its = d.items.filter(t => !excludedIds.has(t.id));
      return [name, {total: its.reduce((s,t)=>s+t.a,0), count: its.length, items: its}];
    })
    .filter(e => e[1].total > 0);
  const labels = chartEntries.map(e=>e[0]);
  const data = chartEntries.map(e=>e[1].total);
  const colors = chartEntries.map((_,i)=>SUB_COLORS[i % SUB_COLORS.length]);
  const total = items.filter(t => !excludedIds.has(t.id) && !excludedSubs.has(catName + '::' + t.sub)).reduce((s,t)=>s+t.a,0);

  updateChart(labels, data, colors, chartEntries);
  document.getElementById('ct-val').textContent = fmt(total);
  document.getElementById('ct-label').textContent = catName;
  document.getElementById('dash-title').textContent = catName;
  document.getElementById('dash-sub').textContent = 'Subcategorías · clic en sección para ver transacciones';
  document.getElementById('hint-text').textContent = 'Clic en sección → lista de transacciones';
  document.getElementById('breadcrumb').innerHTML = '<span onclick="goBack()">Todas</span><span class="sep"> › </span><span style="color:var(--text)">' + catName + '</span>';

  const legendEntries = sorted.map(([name, d], i) => [name, d, SUB_COLORS[i % SUB_COLORS.length]]);
  renderLegend(legendEntries, true, catName);
  // Si hay subcategoría cacheada, mostrar solo sus tx en la lista.
  if (currentSub) {
    const entry = sorted.find(([name]) => name === currentSub);
    if (entry) {
      const [name, d] = entry;
      const idx = sorted.indexOf(entry);
      const color = SUB_COLORS[idx % SUB_COLORS.length];
      renderList(d.items, name, color);
      return;
    }
    // Subcategoría guardada ya no existe: limpiar y caer al render normal
    currentSub = null;
    saveUiState();
  }
  renderList(items, null, null);
}

function renderLegend(entries, isSub, catName) {
  const el = document.getElementById('legend');
  el.innerHTML = '';
  const includedTotal = entries.reduce((s,[name,d]) => {
    const isExcluded = isSub ? excludedSubs.has(catName + '::' + name) : excludedCats.has(name);
    return s + (isExcluded ? 0 : d.total);
  }, 0);
  entries.forEach(([name, d, color]) => {
    const isExcluded = isSub ? excludedSubs.has(catName + '::' + name) : excludedCats.has(name);
    const pct = includedTotal > 0 ? Math.round(d.total / includedTotal * 100) : 0;
    const item = document.createElement('div');
    item.className = 'leg-item' + (isExcluded ? ' muted' : '');
    item.innerHTML = `
      <input type="checkbox" class="leg-check" ${isExcluded ? '' : 'checked'}>
      <div class="leg-dot" style="background:${color}"></div>
      <span class="leg-name">${name}</span>
      <span class="leg-val">${fmt(d.total)} <span style="font-size:10px;color:var(--text-3)">${isExcluded ? '—' : pct+'%'}</span></span>`;
    const check = item.querySelector('.leg-check');
    check.onclick = e => {
      e.stopPropagation();
      const key = isSub ? (catName + '::' + name) : name;
      const set = isSub ? excludedSubs : excludedCats;
      if (check.checked) set.delete(key); else set.add(key);
      render();
    };
    item.onclick = () => {
      if (!isSub) {
        currentCat = name;
        currentSub = null;
        saveUiState();
        render();
      } else {
        currentSub = name;
        saveUiState();
        renderList(d.items, name, color);
      }
    };
    el.appendChild(item);
  });
}

function updateChart(labels, data, colors, sorted) {
  const canvas = document.getElementById('donut-canvas');
  if (chart) { chart.destroy(); chart = null; }
  chart = new Chart(canvas, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 2,
        borderColor: 'transparent',
        hoverBorderColor: 'transparent',
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => ' ' + fmtFull(ctx.raw)
          }
        }
      },
      onClick(evt, elements) {
        if (!elements.length) return;
        const idx = elements[0].index;
        const name = sorted[idx][0];
        if (!currentCat) {
          currentCat = name;
          currentSub = null;
          saveUiState();
          render();
        } else {
          currentSub = name;
          saveUiState();
          renderList(sorted[idx][1].items, name, colors[idx]);
        }
      }
    }
  });
}

function renderList(items, subtitle, color) {
  const el = document.getElementById('tx-scroll');
  const title = document.getElementById('list-title');
  const count = document.getElementById('list-count');
  let rows = [...items];
  const sorters = {
    'date-desc': (a,b) => b.d.localeCompare(a.d),
    'date-asc':  (a,b) => a.d.localeCompare(b.d),
    'amount-desc': (a,b) => b.a - a.a,
    'amount-asc':  (a,b) => a.a - b.a,
  };
  rows.sort(sorters[sortMode] || sorters['date-desc']);
  const q = searchText.trim().toLowerCase();
  if (q) {
    rows = rows.filter(t => {
      const hay = [t.alias, t.m, t.c, t.cat, t.sub, t.d].filter(Boolean).join(' ').toLowerCase();
      return hay.includes(q);
    });
  }
  title.textContent = subtitle || (currentCat ? currentCat : 'Todas las transacciones');
  count.textContent = rows.length + ' transacciones';
  el.innerHTML = '';
  rows.forEach(t => {
    const dot = color || COLORS[t.cat] || '#888';
    const row = document.createElement('div');
    const isExcluded = excludedIds.has(t.id) || excludedCats.has(t.cat) || excludedSubs.has(t.cat + '::' + t.sub);
    row.className = 'tx-row' + (isExcluded ? ' muted' : '');
    row.dataset.id = t.id;
    const alias = t.alias || t.m || t.c || 'Sin descripción';
    // Cuando hay varios datasets activos, añadimos a qué cuenta pertenece.
    let acctTag = '';
    if (currentDatasets.size > 1 && t.__accountId) {
      const acc = ACCOUNTS_BY_ID[t.__accountId];
      if (acc) {
        acctTag = acc.alias || (acc.kind === 'credit_card' ? `··${acc.last4 || ''}` : (t.__accountId.slice(-4)));
      } else {
        acctTag = t.__accountId;
      }
    }
    const sub = [t.d, t.c, acctTag].filter(Boolean).join(' · ');
    const sign = t.dir === 'in' ? '+' : '−';
    const amountClass = 'tx-amount' + (t.dir === 'in' ? ' positive' : '');
    const catExcluded = excludedCats.has(t.cat) || excludedSubs.has(t.cat + '::' + t.sub);
    const manualBadge = t.alias_manual ? '<span class="alias-badge" title="Alias editado manualmente">✎</span>' : '';
    row.innerHTML = `
      <input type="checkbox" class="tx-check" ${excludedIds.has(t.id) || catExcluded ? '' : 'checked'} ${catExcluded ? 'disabled' : ''}>
      <div class="tx-dot" style="background:${dot}"></div>
      <div class="tx-info">
        <div class="tx-merchant">${alias}${manualBadge}</div>
        <div class="tx-date">${sub}</div>
      </div>
      <div>
        <div class="${amountClass}">${sign}${fmtFull(t.a)}</div>
        <div class="tx-sub">${t.sub}</div>
      </div>`;
    const check = row.querySelector('.tx-check');
    check.onclick = e => {
      e.stopPropagation();
      if (check.checked) excludedIds.delete(t.id); else excludedIds.add(t.id);
      render();
    };
    row.onclick = e => {
      if (e.target === check) return;
      openEditor(row, t);
    };
    el.appendChild(row);
  });
}

function openEditor(row, t) {
  if (row.classList.contains('editing')) return;
  row.classList.add('editing');

  if (t.raw && t.raw.length) {
    const details = document.createElement('dl');
    details.className = 'tx-details';
    details.onclick = e => e.stopPropagation();
    t.raw.forEach(kv => {
      const dt = document.createElement('dt');
      dt.textContent = kv.k;
      const dd = document.createElement('dd');
      dd.textContent = kv.v;
      details.appendChild(dt);
      details.appendChild(dd);
    });
    row.appendChild(details);
  }

  const aliasBar = document.createElement('div');
  aliasBar.className = 'tx-edit-bar tx-alias-bar';
  aliasBar.onclick = e => e.stopPropagation();
  const aliasInput = document.createElement('input');
  aliasInput.type = 'text';
  aliasInput.placeholder = 'Alias';
  aliasInput.value = t.alias || '';
  aliasInput.className = 'alias-input';
  const aliasLabel = document.createElement('span');
  aliasLabel.className = 'alias-label';
  aliasLabel.textContent = t.alias_manual ? 'Manual' : 'Auto';
  aliasInput.addEventListener('input', () => { aliasLabel.textContent = 'Manual'; });
  aliasBar.appendChild(aliasLabel);
  aliasBar.appendChild(aliasInput);
  if (t.alias_manual) {
    const resetAliasBtn = document.createElement('button');
    resetAliasBtn.className = 'save-btn';
    resetAliasBtn.style.background = 'transparent';
    resetAliasBtn.style.color = 'var(--text-2)';
    resetAliasBtn.textContent = 'Restaurar auto';
    resetAliasBtn.onclick = () => {
      const idx = RAW.findIndex(x => x.id === t.id);
      if (idx >= 0) {
        RAW[idx].alias_manual = false;
        // Recalcular alias con la lógica del cliente (simple fallback: usar merchant)
        // La fuente de verdad es el servidor. Tras guardar y recargar tendrá el alias automático.
        dirty = true;
        updateSaveButton();
        row.classList.remove('editing');
        aliasBar.remove();
        bar.remove();
        const details = row.querySelector('.tx-details');
        if (details) details.remove();
        // Recarga el dataset para obtener el alias auto recalculado por el servidor.
        loadDataset(currentDataset);
      }
    };
    aliasBar.appendChild(resetAliasBtn);
  }
  row.appendChild(aliasBar);

  const bar = document.createElement('div');
  bar.className = 'tx-edit-bar';
  bar.onclick = e => e.stopPropagation();

  const catSel = document.createElement('select');
  Object.keys(TAXONOMY).forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat; opt.textContent = cat;
    if (cat === t.cat) opt.selected = true;
    catSel.appendChild(opt);
  });

  const subSel = document.createElement('select');
  function populateSubs(cat, selectedSub) {
    subSel.innerHTML = '';
    (TAXONOMY[cat] || []).forEach(sub => {
      const opt = document.createElement('option');
      opt.value = sub; opt.textContent = sub;
      if (sub === selectedSub) opt.selected = true;
      subSel.appendChild(opt);
    });
  }
  populateSubs(t.cat, t.sub);
  catSel.onchange = () => populateSubs(catSel.value, null);

  const applyBtn = document.createElement('button');
  applyBtn.className = 'save-btn';
  applyBtn.textContent = 'Aplicar';
  applyBtn.onclick = async () => {
    const idx = RAW.findIndex(x => x.id === t.id && x.__accountId === t.__accountId);
    if (idx < 0) return;
    const prevCat = t.cat;
    const prevSub = t.sub;
    const prevAlias = t.alias || '';

    RAW[idx].cat = catSel.value;
    RAW[idx].sub = subSel.value;
    const newAlias = aliasInput.value.trim();
    if (newAlias && newAlias !== prevAlias) {
      RAW[idx].alias = newAlias;
      RAW[idx].alias_manual = true;
    } else if (!newAlias) {
      RAW[idx].alias = '';
      RAW[idx].alias_manual = false;
    }

    const catChanged = catSel.value !== prevCat || subSel.value !== prevSub;
    const aliasChanged = RAW[idx].alias_manual && RAW[idx].alias !== prevAlias;

    setStatus('Guardando…');
    try {
      const txAccountId = RAW[idx].__accountId || currentDataset;
      const { __accountId, ...txToSave } = RAW[idx];
      await window.__fb.upsertTransaction(txAccountId, txToSave);

      if (catChanged || aliasChanged) {
        recordObservation({
          merchant: RAW[idx].m,
          txId: RAW[idx].id,
          cat: catChanged ? catSel.value : null,
          sub: catChanged ? subSel.value : null,
          alias: aliasChanged ? RAW[idx].alias : null,
        }).catch(err => console.error('recordObservation error', err));
      }
      setStatus('Guardado ✓', 'ok');
      setTimeout(() => setStatus('', null), 1200);
    } catch (err) {
      setStatus('Error al guardar', 'err');
      console.error(err);
    }
    render();
  };

  // Botón batch: aplica la misma categoría (y alias si cambió manualmente)
  // a todas las tx cuyo alias original coincida con el de la tx editada.
  const aliasForBatch = (t.alias || '').trim();
  const batchCandidates = aliasForBatch
    ? RAW.filter(x => !(x.id === t.id && x.__accountId === t.__accountId) && (x.alias || '').trim() === aliasForBatch)
    : [];
  let batchBtn = null;
  if (batchCandidates.length > 0) {
    batchBtn = document.createElement('button');
    batchBtn.className = 'save-btn';
    batchBtn.style.background = 'transparent';
    batchBtn.style.color = 'var(--info)';
    batchBtn.style.border = '1px solid var(--border-strong)';
    batchBtn.textContent = `Aplicar a todos (${batchCandidates.length + 1})`;
    batchBtn.title = `Aplica la categoría y alias (si cambió) a las ${batchCandidates.length + 1} transacciones con alias "${aliasForBatch}"`;
    batchBtn.onclick = async () => {
      const total = batchCandidates.length + 1;
      const newAliasRaw = aliasInput.value.trim();
      const aliasChanged = newAliasRaw && newAliasRaw !== aliasForBatch;
      if (total > 5) {
        const parts = [`${catSel.value} / ${subSel.value}`];
        if (aliasChanged) parts.push(`alias "${newAliasRaw}"`);
        const ok = confirm(`Vas a aplicar ${parts.join(' y ')} a ${total} transacciones con alias "${aliasForBatch}". ¿Continuar?`);
        if (!ok) return;
      }
      setStatus(`Aplicando a ${total}…`);
      try {
        const targets = [t, ...batchCandidates];
        const writes = [];
        const observations = [];
        for (const tx of targets) {
          const idx2 = RAW.findIndex(x => x.id === tx.id && x.__accountId === tx.__accountId);
          if (idx2 < 0) continue;
          const prevC = RAW[idx2].cat;
          const prevS = RAW[idx2].sub;
          const prevA = RAW[idx2].alias || '';
          RAW[idx2].cat = catSel.value;
          RAW[idx2].sub = subSel.value;
          const catDidChange = prevC !== catSel.value || prevS !== subSel.value;
          let aliasDidChange = false;
          if (aliasChanged) {
            RAW[idx2].alias = newAliasRaw;
            RAW[idx2].alias_manual = true;
            aliasDidChange = prevA !== newAliasRaw;
          }
          const txAccId = RAW[idx2].__accountId || currentDataset;
          const { __accountId, ...txToSave } = RAW[idx2];
          writes.push(window.__fb.upsertTransaction(txAccId, txToSave));
          if (catDidChange || aliasDidChange) {
            observations.push({
              merchant: RAW[idx2].m, txId: RAW[idx2].id,
              cat: catDidChange ? catSel.value : null,
              sub: catDidChange ? subSel.value : null,
              alias: aliasDidChange ? newAliasRaw : null,
            });
          }
        }
        await Promise.all(writes);
        // Observations: una por cada tx cambiada (categoría y/o alias).
        for (const obs of observations) {
          const tok = tokenForMerchant(obs.merchant);
          if (!tok) continue;
          if (obs.cat && obs.sub) {
            await window.__fb.addObservation(
              obsDocId(tok.key, obs.txId, 'cat'),
              { token: tok.key, tokenKind: tok.kind, kind: 'cat',
                cat: obs.cat, sub: obs.sub,
                sourceMerchant: obs.merchant || '',
                txId: obs.txId, createdAt: Date.now() }
            );
          }
          if (obs.alias) {
            await window.__fb.addObservation(
              obsDocId(tok.key, obs.txId, 'alias'),
              { token: tok.key, tokenKind: tok.kind, kind: 'alias',
                alias: obs.alias,
                sourceMerchant: obs.merchant || '',
                txId: obs.txId, createdAt: Date.now() }
            );
          }
        }
        if (observations.length) {
          const allObs = await window.__fb.listObservations();
          const validated = computeValidatedRules(allObs);
          await promoteValidatedRules(validated);
        }
        setStatus(`${total} aplicadas ✓`, 'ok');
        setTimeout(() => setStatus('', null), 1500);
      } catch (err) {
        setStatus('Error en batch', 'err');
        console.error(err);
      }
      render();
    };
  }

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'save-btn';
  cancelBtn.style.background = 'transparent';
  cancelBtn.style.color = 'var(--color-text-secondary)';
  cancelBtn.textContent = 'Cancelar';
  cancelBtn.onclick = () => {
    row.classList.remove('editing');
    bar.remove();
    aliasBar.remove();
    const details = row.querySelector('.tx-details');
    if (details) details.remove();
    const sugg = row.querySelector('.tx-suggest');
    if (sugg) sugg.remove();
    const footer = row.querySelector('.tx-edit-footer');
    if (footer) footer.remove();
  };

  bar.appendChild(catSel);
  bar.appendChild(subSel);
  bar.appendChild(applyBtn);
  bar.appendChild(cancelBtn);
  row.appendChild(bar);

  // Fila inferior: sugerencia a la izquierda + botón batch a la derecha.
  // Si solo hay uno de los dos, ese elemento queda en su lado natural.
  const suggestion = findCategorySuggestion(t);
  if (suggestion || batchBtn) {
    const footer = document.createElement('div');
    footer.className = 'tx-edit-footer';
    footer.onclick = e => e.stopPropagation();

    if (suggestion) {
      const sugg = document.createElement('div');
      sugg.className = 'tx-suggest';
      const label = document.createElement('span');
      label.className = 'tx-suggest-label';
      label.textContent = 'Sugerencia:';
      const link = document.createElement('a');
      link.className = 'tx-suggest-link';
      link.href = '#';
      link.textContent = `${suggestion.cat} · ${suggestion.sub}`;
      link.title = suggestion.source === 'similar'
        ? `Basado en ${suggestion.count} transacción(es) similar(es)`
        : 'Basado en palabras clave del nombre';
      link.onclick = (e) => {
        e.preventDefault();
        catSel.value = suggestion.cat;
        populateSubs(suggestion.cat, suggestion.sub);
      };
      sugg.appendChild(label);
      sugg.appendChild(link);
      footer.appendChild(sugg);
    }

    if (batchBtn) {
      footer.appendChild(batchBtn);
    }

    row.appendChild(footer);
  }
}

function normalizeForMatch(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/\d{4,}/g, ' ')           // IDs numéricos largos (4+ dígitos)
    .replace(/\*/g, ' ')                // asterisco de SQ *, UBR*, etc.
    .replace(/[^a-z0-9áéíóúñü&\s]/gi, ' ')  // puntuación
    .replace(/\b(s\s*a\s*u?|s\s*l\s*u?|llc|bv|espana|spain|bcn|barcelona|madrid|europe|online|www|com|es)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Reglas genéricas por palabra clave cargadas desde suggestion_rules.json.
// Se usan como fallback cuando no hay transacciones similares ya categorizadas.
let KEYWORD_SUGGESTIONS = [];

async function loadSuggestionRules() {
  try {
    const data = await window.__fb.getConfig('suggestion_rules');
    KEYWORD_SUGGESTIONS = ((data && data.rules) || []).map(r => ({
      patterns: (r.patterns || []).map(p => p.toLowerCase()),
      cat: r.cat,
      sub: r.sub,
    }));
  } catch (_) { /* silently ignore */ }
}

function findCategorySuggestion(t) {
  // 1) Busca transacciones similares ya categorizadas (no Other/Other).
  const primary = normalizeForMatch(t.alias || t.m || '');
  const fallback = normalizeForMatch(t.m || '');
  const tokens = new Set([primary, fallback].flatMap(s => s.split(' ')).filter(w => w.length >= 4));

  if (tokens.size) {
    const counts = new Map();
    for (const o of RAW) {
      if (o.id === t.id) continue;
      if (o.cat === 'Other' && o.sub === 'Other') continue;
      const oNorm = normalizeForMatch(o.alias || o.m || '');
      if (!oNorm) continue;
      const oTokens = new Set(oNorm.split(' ').filter(w => w.length >= 4));
      let shared = 0;
      for (const tk of tokens) if (oTokens.has(tk)) shared++;
      if (!shared) continue;
      const k = o.cat + '::' + o.sub;
      counts.set(k, (counts.get(k) || 0) + shared);
    }
    if (counts.size) {
      let best = null;
      for (const [k, n] of counts) {
        if (!best || n > best.n) best = { k, n };
      }
      const [cat, sub] = best.k.split('::');
      if (cat !== t.cat || sub !== t.sub) {
        return { cat, sub, count: best.n, source: 'similar' };
      }
    }
  }

  // 2) Fallback: palabras clave genéricas (suggestion_rules.json).
  const hay = `${t.alias || ''} ${t.m || ''} ${t.c || ''}`.toLowerCase();
  for (const rule of KEYWORD_SUGGESTIONS) {
    for (const p of rule.patterns) {
      if (hay.includes(p)) {
        if (rule.cat === t.cat && rule.sub === t.sub) return null;
        return { cat: rule.cat, sub: rule.sub, count: 0, source: 'keyword' };
      }
    }
  }
  return null;
}

let autoSaveSupported = true;

let __toastHideTimer = null;
function setStatus(text, kind) {
  const el = document.getElementById('toast');
  if (!el) return;
  if (__toastHideTimer) { clearTimeout(__toastHideTimer); __toastHideTimer = null; }
  if (!text) {
    el.classList.remove('show');
    __toastHideTimer = setTimeout(() => el.setAttribute('hidden', ''), 220);
    return;
  }
  el.removeAttribute('hidden');
  el.textContent = text;
  el.className = 'toast' + (kind ? ' ' + kind : '');
  requestAnimationFrame(() => el.classList.add('show'));
}

function buildPayload() {
  return { version: 1, account: ACCOUNT, taxonomy: TAXONOMY, transactions: RAW };
}

function downloadJSON() {
  const blob = new Blob([JSON.stringify(buildPayload(), null, 2)], {type: 'application/json'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'transactions.json';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

async function autoSave() {
  // Se usa desde el drawer (cambios de account). Las transacciones editadas
  // se guardan directamente con upsertTransaction al pulsar Aplicar.
  if (!currentDataset) return;
  setStatus('Guardando…');
  try {
    await window.__fb.setAccount(currentDataset, ACCOUNT);
    dirty = false;
    setStatus('Guardado ✓', 'ok');
    setTimeout(() => setStatus('', null), 1500);
  } catch (err) {
    setStatus('Error al guardar', 'err');
    console.error('autoSave error', err);
  }
}

async function upsertTxSilent(tx) {
  if (!currentDataset) return;
  try { await window.__fb.upsertTransaction(currentDataset, tx); }
  catch (err) { console.error('upsertTx error', err); }
}

// ---------- Aprendizaje con observations ----------
// Modelo: cada edición manual se guarda como una observation. Cuando un token
// acumula >= VALIDATION_THRESHOLD observaciones iguales (misma cat/sub o
// mismo alias), esa asociación se promueve a regla en user_rules /
// merchant_aliases. Invisible para el usuario — solo ve sugerencias cuando
// están validadas.

const VALIDATION_THRESHOLD = 3;

const LEARN_STOPWORDS = new Set([
  'SANTIAGO','BUSTAMANTE','GARCIA','CORE','COREGRUPO','COREGC','COREAIGUES','COREHOSP',
  'NOTPROVIDE','PENDING','HELP','RIDES','TRIP','TARJETA','VISA','MASTERCARD',
  'TRASPASO','AMORTIZACION','AMORTIZACIÓN','AJUSTE','MYCARD','AVANCE','PAGO',
  'SPAIN','ESPANA','ESPAÑA','EUROPE','ONLINE','BARCELONA','MADRID','ANDORRA',
  'SUMUP','SQ','SP','UBR','COREGCGC','CORETGSS','COREHOSP',
]);

function stableTokenFromMerchant(merchant) {
  if (!merchant) return null;
  let s = merchant.toUpperCase()
    .replace(/\bD-[0-9A-Z]{6,}\b/g, ' ')
    .replace(/\b\d{4,}\b/g, ' ')
    .replace(/\*/g, ' ')
    .replace(/[^A-Z0-9ÁÉÍÓÚÑ&\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  for (const w of s.split(' ')) {
    if (w.length >= 5 && !LEARN_STOPWORDS.has(w)) return w;
  }
  return null;
}

function tokenForMerchant(merchant) {
  const stable = stableTokenFromMerchant(merchant);
  if (stable) return { key: stable, kind: 'pattern' };
  const exact = (merchant || '').trim().toUpperCase();
  if (exact) return { key: exact, kind: 'merchant' };
  return null;
}

function obsDocId(tokenKey, txId, kind) {
  // Un doc único por (token, tx, kind). Si el usuario edita la MISMA tx dos
  // veces con distinto valor, la segunda sobrescribe la primera (sigue siendo
  // 1 observation para esa tx).
  const safe = (s) => s.replace(/[^\w-]+/g, '_');
  return `${safe(tokenKey)}__${kind}__${safe(txId)}`;
}

// Evalúa las observations actuales y genera las reglas validadas.
// Q2 variante b: mayoría con umbral mínimo de VALIDATION_THRESHOLD para el
// ganador. Si ninguna cat tiene >=VALIDATION_THRESHOLD, no promueve nada.
function computeValidatedRules(allObs) {
  // Agrupamos por (token, kind="cat"|"alias")
  const catGroups = new Map();
  const aliasGroups = new Map();
  for (const o of allObs) {
    if (!o.token) continue;
    if (o.kind === 'cat' && o.cat && o.sub) {
      const key = `${o.tokenKind}::${o.token}`;
      if (!catGroups.has(key)) catGroups.set(key, []);
      catGroups.get(key).push(o);
    } else if (o.kind === 'alias' && o.alias) {
      if (!aliasGroups.has(o.token)) aliasGroups.set(o.token, []);
      aliasGroups.get(o.token).push(o);
    }
  }

  const catValidated = [];   // [{tokenKind, token, cat, sub, count}]
  for (const [key, obs] of catGroups) {
    const [tokenKind, token] = key.split('::');
    const counts = new Map();
    for (const o of obs) {
      const k = `${o.cat}::${o.sub}`;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    let best = null;
    for (const [k, n] of counts) {
      if (!best || n > best.n) best = { k, n };
    }
    if (best && best.n >= VALIDATION_THRESHOLD) {
      const [cat, sub] = best.k.split('::');
      catValidated.push({ tokenKind, token, cat, sub, count: best.n });
    }
  }

  const aliasValidated = []; // [{token, alias, count}]
  for (const [token, obs] of aliasGroups) {
    const counts = new Map();
    for (const o of obs) counts.set(o.alias, (counts.get(o.alias) || 0) + 1);
    let best = null;
    for (const [a, n] of counts) {
      if (!best || n > best.n) best = { a, n };
    }
    if (best && best.n >= VALIDATION_THRESHOLD) {
      aliasValidated.push({ token, alias: best.a, count: best.n });
    }
  }

  return { catValidated, aliasValidated };
}

// Fusiona las reglas validadas con user_rules / merchant_aliases existentes.
// Q3: las reglas ya presentes se conservan. Si llega una nueva validada para
// un token que ya tenía otra categoría, se sobrescribe con la nueva.
async function promoteValidatedRules(validated) {
  const [uCfg, aCfg] = await Promise.all([
    window.__fb.getConfig('user_rules'),
    window.__fb.getConfig('merchant_aliases'),
  ]);
  const userRules = {
    merchants: (uCfg && uCfg.merchants) ? { ...uCfg.merchants } : {},
    patterns: (uCfg && uCfg.patterns) ? [...uCfg.patterns] : [],
  };
  const aliasRules = (aCfg && aCfg.rules) ? [...aCfg.rules] : [];

  let changedUser = false;
  let changedAlias = false;

  for (const v of validated.catValidated) {
    if (v.tokenKind === 'pattern') {
      userRules.patterns = userRules.patterns.filter(p => {
        const pats = Array.isArray(p) ? p[0] : (p.patterns || []);
        return !pats.includes(v.token);
      });
      userRules.patterns.push({ patterns: [v.token], cat: v.cat, sub: v.sub });
      changedUser = true;
    } else {
      if (!userRules.merchants[v.token] ||
          userRules.merchants[v.token][0] !== v.cat ||
          userRules.merchants[v.token][1] !== v.sub) {
        userRules.merchants[v.token] = [v.cat, v.sub];
        changedUser = true;
      }
    }
  }

  for (const v of validated.aliasValidated) {
    const existing = aliasRules.find(r =>
      (r.patterns || []).some(p => p.toUpperCase() === v.token)
    );
    if (existing && existing.alias === v.alias) continue;
    const filtered = aliasRules.filter(r =>
      !(r.patterns || []).some(p => p.toUpperCase() === v.token)
    );
    filtered.push({ patterns: [v.token], alias: v.alias });
    aliasRules.length = 0;
    aliasRules.push(...filtered);
    changedAlias = true;
  }

  if (changedUser) await window.__fb.setConfig('user_rules', userRules);
  if (changedAlias) await window.__fb.setConfig('merchant_aliases', { rules: aliasRules });
  return { changedUser, changedAlias };
}

// Registra una observation por edición manual. Devuelve lo que se escribió
// (para logging/diagnóstico). Tras guardar re-evalúa validaciones.
async function recordObservation({ merchant, txId, cat, sub, alias }) {
  const tok = tokenForMerchant(merchant);
  if (!tok) return;
  const writes = [];
  if (cat && sub) {
    const id = obsDocId(tok.key, txId, 'cat');
    const obs = {
      token: tok.key, tokenKind: tok.kind, kind: 'cat',
      cat, sub,
      sourceMerchant: merchant || '',
      txId, createdAt: Date.now(),
    };
    writes.push(window.__fb.addObservation(id, obs));
  }
  if (alias) {
    const id = obsDocId(tok.key, txId, 'alias');
    const obs = {
      token: tok.key, tokenKind: tok.kind, kind: 'alias',
      alias, sourceMerchant: merchant || '',
      txId, createdAt: Date.now(),
    };
    writes.push(window.__fb.addObservation(id, obs));
  }
  if (!writes.length) return;
  await Promise.all(writes);

  // Recalculamos validaciones y promovemos si toca.
  const allObs = await window.__fb.listObservations();
  const validated = computeValidatedRules(allObs);
  await promoteValidatedRules(validated);
}

function updateSaveButton() {
  if (!autoSaveSupported) {
    document.getElementById('download-transactions-btn').style.display = dirty ? '' : 'none';
    return;
  }
  autoSave();
}

document.getElementById('download-transactions-btn').addEventListener('click', () => {
  downloadJSON();
  dirty = false;
  document.getElementById('download-transactions-btn').style.display = 'none';
});

function goBack() {
  currentCat = null;
  currentSub = null;
  saveUiState();
  render();
}

document.getElementById('date-from').addEventListener('change', () => {
  currentCat = null; currentSub = null;
  activePreset = null;
  updatePresetUI();
  saveUiState(); render();
});
document.getElementById('date-to').addEventListener('change', () => {
  currentCat = null; currentSub = null;
  activePreset = null;
  updatePresetUI();
  saveUiState(); render();
});

// ---------- Presets de rango ----------
let activePreset = null;

function fmtISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
function startOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
function endOfMonth(d)   { return new Date(d.getFullYear(), d.getMonth() + 1, 0); }
function addMonths(d, n) {
  const r = new Date(d);
  r.setMonth(r.getMonth() + n);
  return r;
}

function applyPreset(preset) {
  const today = new Date();
  let from, to;
  switch (preset) {
    case 'month':      from = startOfMonth(today); to = endOfMonth(today); break;
    case 'last-month': {
      const d = addMonths(today, -1);
      from = startOfMonth(d); to = endOfMonth(d);
      break;
    }
    case '3m':  from = addMonths(today, -3); to = today; break;
    case '6m':  from = addMonths(today, -6); to = today; break;
    case 'ytd': from = new Date(today.getFullYear(), 0, 1); to = today; break;
    case 'all': {
      if (!RAW.length) return;
      const dates = RAW.map(t => t.d).sort();
      document.getElementById('date-from').value = dates[0];
      document.getElementById('date-to').value = dates[dates.length - 1];
      activePreset = 'all';
      updatePresetUI();
      currentCat = null; currentSub = null;
      saveUiState(); render();
      return;
    }
    default: return;
  }
  document.getElementById('date-from').value = fmtISO(from);
  document.getElementById('date-to').value   = fmtISO(to);
  activePreset = preset;
  updatePresetUI();
  currentCat = null; currentSub = null;
  saveUiState(); render();
}

function updatePresetUI() {
  document.querySelectorAll('#range-presets .chip[data-preset]').forEach(b => {
    b.classList.toggle('active', b.dataset.preset === activePreset);
  });
}

// Navega según el preset activo (Q2 b). Si no hay preset o es 'all', navega
// mes a mes como default.
function navigateRange(direction) {
  const fromEl = document.getElementById('date-from');
  const toEl = document.getElementById('date-to');
  if (!fromEl.value || !toEl.value) return;
  const from = new Date(fromEl.value + 'T00:00:00');
  const to = new Date(toEl.value + 'T00:00:00');

  let newFrom, newTo;
  switch (activePreset) {
    case 'month':
    case 'last-month': {
      // Saltar un mes manteniendo "mes entero"
      const base = addMonths(from, direction);
      newFrom = startOfMonth(base);
      newTo = endOfMonth(base);
      // El preset activo cambia: si estaba 'month' y bajas, pasa a 'last-month' solo si queda exacto
      activePreset = null;
      break;
    }
    case '3m':  newFrom = addMonths(from, direction * 3); newTo = addMonths(to, direction * 3); activePreset = null; break;
    case '6m':  newFrom = addMonths(from, direction * 6); newTo = addMonths(to, direction * 6); activePreset = null; break;
    case 'ytd':
    case 'all':
    default: {
      newFrom = addMonths(from, direction);
      newTo = addMonths(to, direction);
      activePreset = null;
      break;
    }
  }

  fromEl.value = fmtISO(newFrom);
  toEl.value = fmtISO(newTo);
  updatePresetUI();
  currentCat = null; currentSub = null;
  saveUiState(); render();
}

document.querySelectorAll('#range-presets .chip[data-preset]').forEach(btn => {
  btn.addEventListener('click', () => applyPreset(btn.dataset.preset));
});
document.getElementById('range-prev').addEventListener('click', () => navigateRange(-1));
document.getElementById('range-next').addEventListener('click', () => navigateRange(+1));

document.getElementById('tx-search-input').addEventListener('input', (e) => {
  searchText = e.target.value;
  render();
});

function updateSortUI() {
  document.querySelectorAll('.sort-option').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.sort === sortMode);
  });
}
updateSortUI();

document.getElementById('sort-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  const dd = document.getElementById('sort-dropdown');
  const btn = document.getElementById('sort-toggle');
  const open = dd.hasAttribute('hidden');
  if (open) { dd.removeAttribute('hidden'); btn.setAttribute('aria-expanded','true'); }
  else { dd.setAttribute('hidden',''); btn.setAttribute('aria-expanded','false'); }
});

document.querySelectorAll('.sort-option').forEach(btn => {
  btn.addEventListener('click', () => {
    sortMode = btn.dataset.sort;
    updateSortUI();
    saveUiState();
    document.getElementById('sort-dropdown').setAttribute('hidden','');
    document.getElementById('sort-toggle').setAttribute('aria-expanded','false');
    render();
  });
});

document.addEventListener('click', (e) => {
  const dd = document.getElementById('sort-dropdown');
  const btn = document.getElementById('sort-toggle');
  if (!dd || dd.hasAttribute('hidden')) return;
  if (!dd.contains(e.target) && !btn.contains(e.target)) {
    dd.setAttribute('hidden','');
    btn.setAttribute('aria-expanded','false');
  }
});

document.getElementById('reset-selection-btn').addEventListener('click', () => {
  excludedIds.clear();
  excludedCats.clear();
  excludedSubs.clear();
  searchText = '';
  document.getElementById('tx-search-input').value = '';
  render();
});

function fmtDatasetLabel(ds) {
  const bank = ds.bank || '';
  const isCard = ds.kind === 'credit_card';
  const cardLabel = ds.card_type ? ds.card_type : 'Tarjeta';
  if (isCard) {
    const last4 = ds.last4 || ds.name.replace(/^cc-/, '').replace(/\.json$/, '');
    const head = ds.alias ? ds.alias : (bank ? `${cardLabel} ${bank}` : cardLabel);
    return `${head} · ··${last4}`;
  }
  if (ds.alias) {
    return bank ? `${ds.alias} · ${bank}` : ds.alias;
  }
  const acctNum = ds.name.replace(/\.json$/, '');
  const last4 = acctNum.slice(-4);
  return bank ? `${bank} · ${last4}` : acctNum;
}

async function refreshDatasetList(preferredIds) {
  try {
    const accounts = await window.__fb.listAccounts();
    ALL_ACCOUNTS = accounts;
    ACCOUNTS_BY_ID = {};
    for (const acc of accounts) ACCOUNTS_BY_ID[acc.id] = acc;

    const menu = document.getElementById('dataset-menu');
    menu.innerHTML = '';
    if (!accounts.length) {
      menu.innerHTML = '<div style="padding:10px;font-size:13px;color:var(--text-3)">— ningún dataset —</div>';
      document.getElementById('dataset-label').textContent = '—';
      return null;
    }

    const preferredSet = new Set(preferredIds instanceof Set ? [...preferredIds]
                                 : (Array.isArray(preferredIds) ? preferredIds
                                 : (preferredIds ? [preferredIds] : [])));
    // Si no hay seleccion previa, elegimos el último (convención actual)
    const chosenIds = preferredSet.size
      ? [...preferredSet].filter(id => accounts.some(a => a.id === id))
      : [accounts[accounts.length - 1].id];

    accounts.forEach(acc => {
      const ds = {
        name: acc.id,
        alias: acc.alias || '',
        bank: acc.bank || '',
        kind: acc.kind || 'account',
        last4: acc.last4 || '',
        card_type: acc.card_type || '',
      };
      const label = fmtDatasetLabel(ds);
      const row = document.createElement('label');
      row.className = 'dataset-option';
      const isChecked = chosenIds.includes(acc.id);
      row.innerHTML = `<input type="checkbox" value="${acc.id}" ${isChecked ? 'checked' : ''}><span>${label}</span>`;
      row.querySelector('input').addEventListener('change', onDatasetToggle);
      menu.appendChild(row);
    });

    return new Set(chosenIds);
  } catch (err) {
    const menu = document.getElementById('dataset-menu');
    if (menu) menu.innerHTML = '<div style="padding:10px;color:var(--err)">Error al listar</div>';
    throw err;
  }
}

function updateDatasetLabel() {
  const el = document.getElementById('dataset-label');
  if (!el) return;
  const active = [...currentDatasets];
  if (active.length === 0) { el.textContent = '—'; return; }
  if (active.length === 1) {
    const acc = ACCOUNTS_BY_ID[active[0]];
    if (!acc) { el.textContent = active[0]; return; }
    el.textContent = fmtDatasetLabel({
      name: acc.id, alias: acc.alias || '', bank: acc.bank || '',
      kind: acc.kind || 'account', last4: acc.last4 || '', card_type: acc.card_type || '',
    });
    return;
  }
  el.textContent = `${active.length} datasets`;
}

async function onDatasetToggle(e) {
  const id = e.target.value;
  const checked = e.target.checked;
  const next = new Set(currentDatasets);
  if (checked) next.add(id);
  else next.delete(id);
  if (!next.size) {
    // No permitir 0 seleccionados: vuelve a marcar el checkbox.
    e.target.checked = true;
    return;
  }
  await loadDatasets(next);
}

function setAccountDrawerVisible(visible) {
  const btn = document.getElementById('account-toggle');
  if (!btn) return;
  btn.style.display = visible ? '' : 'none';
}

async function loadDatasets(idsSet) {
  currentDatasets = new Set(idsSet);
  currentDataset = [...currentDatasets][0] || null;
  const stateKey = uiStateKeyFor(currentDatasets);
  const savedState = loadUiStateByKey(stateKey);
  currentCat = savedState?.cat || null;
  currentSub = savedState?.sub || null;
  if (savedState?.sortMode) sortMode = savedState.sortMode;
  activePreset = savedState?.preset || null;
  updatePresetUI();
  excludedIds.clear(); excludedCats.clear(); excludedSubs.clear();
  searchText = '';
  const searchEl = document.getElementById('tx-search-input');
  if (searchEl) searchEl.value = '';
  updateSortUI();

  try {
    // TAXONOMY global (solo una vez)
    const taxCfg = await window.__fb.getConfig('taxonomy');
    if (taxCfg && taxCfg.taxonomy) TAXONOMY = taxCfg.taxonomy;

    // Cargar accounts + transacciones en paralelo para todos los datasets activos.
    const ids = [...currentDatasets];
    const results = await Promise.all(ids.map(async (id) => {
      const [acc, txs] = await Promise.all([
        ACCOUNTS_BY_ID[id] ? Promise.resolve(ACCOUNTS_BY_ID[id]) : window.__fb.getAccount(id),
        window.__fb.listTransactions(id),
      ]);
      return { id, account: acc, txs };
    }));

    // RAW unificado, cada tx marcada con su accountId.
    RAW = [];
    for (const r of results) {
      ACCOUNTS_BY_ID[r.id] = r.account;
      for (const t of r.txs) RAW.push(Object.assign({}, t, { __accountId: r.id }));
    }

    // Drawer de detalles solo con 1 dataset.
    const single = ids.length === 1;
    setAccountDrawerVisible(single);
    if (single) {
      const acc = results[0].account || {};
      ACCOUNT = Object.assign({iban:'', bank:'', alias:'', kind:'account', last4:'', card_type:'', holder:''}, acc);
      const drawer = document.getElementById('account-panel');
      drawer.setAttribute('data-kind', ACCOUNT.kind || 'account');
      const tag = document.getElementById('acct-kind-tag');
      tag.textContent = ACCOUNT.kind === 'credit_card' ? 'Tarjeta de crédito' : 'Cuenta corriente';
      document.getElementById('acct-alias').value = ACCOUNT.alias;
      document.getElementById('acct-bank').value = ACCOUNT.bank;
      document.getElementById('acct-iban').value = ACCOUNT.iban || '';
      document.getElementById('acct-card-type').value = ACCOUNT.card_type || '';
      document.getElementById('acct-last4').value = ACCOUNT.last4 || '';
      document.getElementById('acct-holder').value = ACCOUNT.holder || '';
    }

    if (RAW.length) {
      const dates = RAW.map(t => t.d).sort();
      document.getElementById('date-from').value = savedState?.from || dates[0];
      document.getElementById('date-to').value = savedState?.to || dates[dates.length - 1];
    }

    updateDatasetLabel();
    updateDatasetMenuCheckboxes();
    saveLastSelection();
    render();
  } catch (err) {
    showLoadError(err);
  }
}

// Retrocompat: mantén loadDataset como alias para un solo dataset.
async function loadDataset(accountId) {
  return loadDatasets(new Set([accountId]));
}

function updateDatasetMenuCheckboxes() {
  document.querySelectorAll('#dataset-menu input[type=checkbox]').forEach(cb => {
    cb.checked = currentDatasets.has(cb.value);
  });
}

async function afterAuth() {
  try {
    await window.__fb.ensureProjectInitialized();
  } catch (err) {
    showLoadError(err);
    return;
  }
  await loadSuggestionRules();
  try {
    const lastSelection = loadLastSelection();
    const chosen = await refreshDatasetList(lastSelection || undefined);
    if (chosen && chosen.size) {
      await loadDatasets(chosen);
    } else {
      document.querySelector('.wrap').insertAdjacentHTML('afterbegin',
        '<div style="padding:16px;border:1px solid var(--border);border-radius:var(--radius-md);margin-bottom:16px;background:var(--panel)">' +
        'No hay datasets en <code>data/</code>. Usa <b>+ Cargar XLS</b> para añadir el primero.' +
        '</div>');
    }
  } catch (err) {
    showLoadError(err);
  }
}

// Popover del selector de datasets
document.getElementById('dataset-toggle').addEventListener('click', (e) => {
  e.stopPropagation();
  const menu = document.getElementById('dataset-menu');
  const btn = document.getElementById('dataset-toggle');
  const open = menu.hasAttribute('hidden');
  if (open) { menu.removeAttribute('hidden'); btn.setAttribute('aria-expanded','true'); }
  else { menu.setAttribute('hidden',''); btn.setAttribute('aria-expanded','false'); }
});
document.addEventListener('click', (e) => {
  const menu = document.getElementById('dataset-menu');
  const btn = document.getElementById('dataset-toggle');
  if (!menu || menu.hasAttribute('hidden')) return;
  if (!menu.contains(e.target) && !btn.contains(e.target)) {
    menu.setAttribute('hidden','');
    btn.setAttribute('aria-expanded','false');
  }
});

document.getElementById('upload-btn').addEventListener('click', () => {
  document.getElementById('upload-input').click();
});

function openAccountDrawer(open) {
  const panel = document.getElementById('account-panel');
  const backdrop = document.getElementById('account-backdrop');
  const btn = document.getElementById('account-toggle');
  if (open) {
    backdrop.removeAttribute('hidden');
    requestAnimationFrame(() => {
      backdrop.classList.add('open');
      panel.classList.add('open');
    });
    panel.setAttribute('aria-hidden', 'false');
    btn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
  } else {
    panel.classList.remove('open');
    backdrop.classList.remove('open');
    panel.setAttribute('aria-hidden', 'true');
    btn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    setTimeout(() => backdrop.setAttribute('hidden', ''), 250);
  }
}

document.getElementById('account-toggle').addEventListener('click', () => {
  const panel = document.getElementById('account-panel');
  openAccountDrawer(!panel.classList.contains('open'));
});
document.getElementById('account-close').addEventListener('click', () => openAccountDrawer(false));
document.getElementById('account-backdrop').addEventListener('click', () => openAccountDrawer(false));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const panel = document.getElementById('account-panel');
    if (panel && panel.classList.contains('open')) openAccountDrawer(false);
  }
});

// Autosave al editar cualquier campo de cuenta
let accountSaveTimer = null;
function onAccountInput(field) {
  return (e) => {
    ACCOUNT[field] = e.target.value;
    dirty = true;
    clearTimeout(accountSaveTimer);
    // Debounce: guarda 400ms después del último cambio
    accountSaveTimer = setTimeout(async () => {
      await autoSave();
      // Re-lee la lista de cuentas para que el popover refleje los cambios
      if (field === 'alias' || field === 'bank' || field === 'card_type') {
        await refreshDatasetList(currentDatasets);
        updateDatasetLabel();
        updateDatasetMenuCheckboxes();
      }
    }, 400);
  };
}
document.getElementById('acct-alias').addEventListener('input', onAccountInput('alias'));
document.getElementById('acct-bank').addEventListener('input', onAccountInput('bank'));
document.getElementById('acct-iban').addEventListener('input', onAccountInput('iban'));
document.getElementById('acct-card-type').addEventListener('input', onAccountInput('card_type'));
document.getElementById('acct-holder').addEventListener('input', onAccountInput('holder'));

async function loadUserAndAliasRules() {
  const [userCfg, aliasCfg] = await Promise.all([
    window.__fb.getConfig('user_rules'),
    window.__fb.getConfig('merchant_aliases'),
  ]);
  // `patterns` en Firestore viene como [{patterns, cat, sub}, ...] pero
  // common.categorize espera [[patterns, cat, sub], ...].
  const patternsTuples = (userCfg?.patterns || []).map(p =>
    Array.isArray(p) ? p : [p.patterns || [], p.cat, p.sub]
  );
  const userRules = userCfg
    ? { merchants: Object.fromEntries(
          Object.entries(userCfg.merchants || {}).map(([k, v]) => [k.toUpperCase(), v])),
        patterns: patternsTuples }
    : { merchants: {}, patterns: [] };
  const aliasRules = (aliasCfg && aliasCfg.rules) ? aliasCfg.rules : [];
  return { userRules, aliasRules };
}

async function processAndUploadXls(file, last4) {
  const { userRules, aliasRules } = await loadUserAndAliasRules();
  const { accountId, account, transactions } = await window.__fb.parseXls(file, {
    last4, aliasRules, userRules,
  });
  // Si la cuenta ya existe, preserva campos editados por el usuario.
  const existing = await window.__fb.getAccount(accountId);
  const accToWrite = Object.assign({}, account);
  if (existing) {
    for (const k of ['iban','bank','alias','card_type','holder']) {
      if (existing[k]) accToWrite[k] = existing[k];
    }
    // Dedup: cargar ids existentes y filtrar
    const existingTx = await window.__fb.listTransactions(accountId);
    const existingIds = new Set(existingTx.map(t => t.id));
    const newOnes = transactions.filter(t => !existingIds.has(t.id));
    await window.__fb.setAccount(accountId, accToWrite);
    if (newOnes.length) await window.__fb.upsertTransactionsBatch(accountId, newOnes);
    return { accountId, added: newOnes.length, total: existingTx.length + newOnes.length };
  }
  // Cuenta nueva
  await window.__fb.setAccount(accountId, accToWrite);
  await window.__fb.upsertTransactionsBatch(accountId, transactions);
  return { accountId, added: transactions.length, total: transactions.length };
}

document.getElementById('upload-input').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  setStatus('Procesando XLS…');
  try {
    let result;
    try {
      result = await processAndUploadXls(file);
    } catch (err) {
      if (err.code === 'NEEDS_LAST4') {
        const last4 = prompt('Parece un extracto de tarjeta de crédito.\nIntroduce los últimos 4 dígitos:');
        if (!last4 || !/^\d{4}$/.test(last4.trim())) {
          setStatus('Cancelado', 'err');
          return;
        }
        setStatus('Procesando XLS…');
        result = await processAndUploadXls(file, last4.trim());
      } else { throw err; }
    }
    setStatus(`Añadidas ${result.added} nuevas ✓`, 'ok');
    setTimeout(() => setStatus('', null), 2000);
    const chosen = await refreshDatasetList(new Set([result.accountId]));
    if (chosen && chosen.size) await loadDatasets(chosen);
  } catch (err) {
    setStatus('Error al subir', 'err');
    alert('No se pudo procesar el archivo: ' + err.message);
  } finally {
    e.target.value = '';
  }
});

function showLoadError(err) {
  document.querySelector('.wrap').innerHTML =
    '<div style="padding:24px;border:1px solid var(--border);border-radius:var(--radius-lg);max-width:640px;margin:24px auto;background:var(--panel)">' +
    '<h3 style="font-size:14px;font-weight:500;margin-bottom:8px">No se pudo cargar el dataset</h3>' +
    '<p style="font-size:12px;color:var(--text-2);margin-bottom:12px">Error: ' + err.message + '</p>' +
    '<p style="font-size:12px;color:var(--text-2);margin-bottom:8px">Necesitas el servidor local corriendo:</p>' +
    '<pre style="font-size:11px;background:var(--bg);padding:8px;border-radius:var(--radius-sm);margin-bottom:8px">python3 serve.py</pre>' +
    '<p style="font-size:12px;color:var(--text-2)">Y abre <code>http://localhost:8000/transaction_dashboard.html</code>.</p>' +
    '</div>';
}

// ---- Auth gate ----
const loginOverlay = document.getElementById('login-overlay');
const authSplash = document.getElementById('auth-splash');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
let bootstrapped = false;

function hideSplash() {
  if (authSplash) authSplash.setAttribute('hidden', '');
}
function showLogin() {
  hideSplash();
  loginOverlay.removeAttribute('hidden');
  document.querySelector('.wrap').setAttribute('data-pre-auth', '');
}
function hideLogin() {
  hideSplash();
  loginOverlay.setAttribute('hidden', '');
  document.querySelector('.wrap').removeAttribute('data-pre-auth');
}

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  loginError.textContent = '';
  const email = document.getElementById('login-email').value.trim();
  const pwd = document.getElementById('login-password').value;
  try {
    await window.__fb.fbLogin(email, pwd);
    // onAuth arrancará afterAuth.
  } catch (err) {
    loginError.textContent = 'No se pudo iniciar sesión: ' + (err.message || err);
  }
});

// Esperamos a que el módulo Firebase esté listo (expuesto en window.__fb).
function waitForFb() {
  return new Promise(resolve => {
    const iv = setInterval(() => {
      if (window.__fb && window.__fb.onAuth) { clearInterval(iv); resolve(); }
    }, 25);
  });
}

waitForFb().then(() => {
  window.__fb.onAuth(async (user) => {
    if (!user) {
      bootstrapped = false;
      showLogin();
      setNavVisible(false);
      return;
    }
    hideLogin();
    setNavVisible(true);
    if (!bootstrapped) {
      bootstrapped = true;
      await afterAuth();
    }
    applySectionFromHash();
  });
});

// ---- Nav / secciones ----
const SECTIONS = ['transactions', 'consolidated', 'profile'];
const navDrawer = document.getElementById('nav-drawer');
const navBackdrop = document.getElementById('nav-backdrop');
const navToggle = document.getElementById('nav-toggle');

function setNavVisible(visible) {
  if (visible) navToggle.removeAttribute('hidden');
  else navToggle.setAttribute('hidden', '');
}

function openNav(open) {
  if (open) {
    navBackdrop.removeAttribute('hidden');
    requestAnimationFrame(() => {
      navBackdrop.classList.add('open');
      navDrawer.classList.add('open');
    });
    navDrawer.setAttribute('aria-hidden', 'false');
    navToggle.setAttribute('aria-expanded', 'true');
  } else {
    navDrawer.classList.remove('open');
    navBackdrop.classList.remove('open');
    navDrawer.setAttribute('aria-hidden', 'true');
    navToggle.setAttribute('aria-expanded', 'false');
    setTimeout(() => navBackdrop.setAttribute('hidden', ''), 250);
  }
}

navToggle.addEventListener('click', () => openNav(!navDrawer.classList.contains('open')));
document.getElementById('nav-close').addEventListener('click', () => openNav(false));
navBackdrop.addEventListener('click', () => openNav(false));

document.getElementById('nav-logout').addEventListener('click', async () => {
  openNav(false);
  try {
    await window.__fb.fbLogout();
    // onAuth detectará la salida y mostrará el login.
  } catch (err) {
    console.error('logout error', err);
    setStatus('Error al cerrar sesión', 'err');
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && navDrawer.classList.contains('open')) openNav(false);
});

document.querySelectorAll('.nav-item').forEach(btn => {
  btn.addEventListener('click', () => {
    if (btn.hasAttribute('disabled')) return;
    const section = btn.dataset.section;
    if (location.hash.slice(1) !== section) {
      location.hash = section;
    } else {
      applySectionFromHash();
    }
    openNav(false);
  });
});

function applySectionFromHash() {
  const hash = location.hash.slice(1);
  const section = SECTIONS.includes(hash) ? hash : 'transactions';
  // Marcar nav-item activo
  document.querySelectorAll('.nav-item').forEach(b =>
    b.classList.toggle('active', b.dataset.section === section)
  );
  // Solo "transactions" está implementada; otras siguen mostrando el dashboard
  // pero no hay transición real todavía. Cuando se habiliten, aquí cambiaremos
  // la vista activa del main.
  // Nota: si el hash es distinto a transactions, forzamos volver.
  if (section !== 'transactions') {
    location.hash = 'transactions';
  }
}

window.addEventListener('hashchange', applySectionFromHash);
