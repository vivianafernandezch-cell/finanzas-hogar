// Importar (Spendee CSV/Excel) · Exportar (CSV/Excel) · Respaldo JSON
import { html, useState, useMemo, useEffect } from '../../vendor/preact-htm.js';
import { useStore, Sheet, Seg, toast, confirmAsk, downloadBlob } from './common.js';
import {
  S as Store, personalWallet, householdWallet, categoriesOf, myAccounts, importTransactions, revertImport, existingHashes,
  visibleTx, backupJson, restoreJson, walletLabel, saveAccount,
} from '../store.js';
import { FIELDS, autoMap, buildRows, suggestCategory, guessDayFirst, parseType } from '../logic/importer.js';
import { parseAmount } from '../logic/util.js';
import { filterTx } from '../logic/stats.js';
import { money, uuid, nowIso, ymd, norm } from '../logic/util.js';
import { TX_TYPES } from '../logic/seed.js';
import { lastKnownRate, historicalRates } from '../logic/fx.js';

const XLSX = () => window.XLSX;
import { parseDate as parseDateSafe } from '../logic/importer.js';
const addDaysSafe = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

async function readFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX().read(buf, { type: 'array', cellDates: true, raw: false, codepage: 65001 });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX().utils.sheet_to_json(ws, { defval: '', raw: true });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return { rows, headers };
}

// ================= Importar =================
export function Import({ back }) {
  const S = useStore();
  const [step, setStep] = useState('pick');          // pick → map → preview → done
  const [file, setFile] = useState(null);
  const [data, setData] = useState(null);
  const [map, setMap] = useState({});
  const [dayFirst, setDayFirst] = useState(true);
  const [walletMap, setWalletMap] = useState({});    // valor de "Wallet" de Spendee → id de cartera | ''
  const [catMap, setCatMap] = useState({});          // `${walletId}|${type}|${nombre}` → id | 'new'
  const [accMap, setAccMap] = useState({});
  const [result, setResult] = useState(null);
  const [fxRates, setFxRates] = useState({});      // moneda → { mode: 'hist'|'manual', fn?, rate?, status }
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const pw = personalWallet(), hw = householdWallet();
  const batches = [...S.import_batches.values()].filter(b => !b.deleted_at).sort((a, b) => b.created_at.localeCompare(a.created_at));

  async function onFile(e) {
    const f = e.target.files?.[0]; if (!f) return;
    setErr(''); setBusy(true);
    try {
      const d = await readFile(f);
      if (!d.rows.length) throw new Error('El archivo está vacío o no se pudo leer.');
      const m = autoMap(d.headers);
      setFile(f); setData(d); setMap(m);
      setDayFirst(guessDayFirst(d.rows.map(r => r[m.date])));
      const wallets = [...new Set(d.rows.map(r => String(r[m.wallet] ?? '').trim()))];
      setWalletMap(Object.fromEntries(wallets.map(w => [w, /hogar|casa|home|house/i.test(w) && hw ? hw.id : pw.id])));
      setStep('map');
    } catch (ex) { setErr(ex.message); } finally { setBusy(false); }
  }

  // Categorías encontradas por cartera destino
  const catNeeds = useMemo(() => {
    if (!data) return [];
    const m = new Map();
    const signInc = data.rows.some(r => parseAmount(r[map.amount]) < 0);
    for (const r of data.rows) {
      const w = map.wallet ? walletMap[String(r[map.wallet] ?? '').trim()] : pw.id; if (!w) continue;
      const name = String(r[map.category] ?? '').trim() || 'Otros';
      const pt = parseType(r[map.type], parseAmount(r[map.amount]), signInc); if (pt === 'transfer') continue;
      const typ = pt === 'income' ? 'income' : 'expense';
      const k = `${w}|${typ}|${name}`; m.set(k, (m.get(k) || 0) + 1);
    }
    return [...m.entries()].map(([k, n]) => { const [w, typ, name] = k.split('|'); return { k, w, typ, name, n }; }).sort((a, b) => b.n - a.n);
  }, [data, map, walletMap]);
  const accNeeds = useMemo(() => data && map.account ? [...new Set(data.rows.map(r => String(r[map.account] ?? '').trim()).filter(Boolean))] : [], [data, map]);

  function goPreview() {
    const cm = { ...catMap };
    for (const c of catNeeds) if (!(c.k in cm)) cm[c.k] = suggestCategory(c.name, categoriesOf(c.w, { includeHidden: true })) || 'new';
    const am = { ...accMap };
    for (const a of accNeeds) if (!(a in am)) am[a] = myAccounts({ includeHidden: true }).find(x => norm(x.name) === norm(a))?.id || 'new';
    setCatMap(cm); setAccMap(am); setStep('preview');
  }

  // Construcción (se recalcula al cambiar mapeos) — las categorías "new" usan ids provisionales
  const plan = useMemo(() => {
    if (step !== 'preview' || !data) return null;
    const newCats = new Map(); const newAccs = new Map();
    const res = buildRows(data.rows, {
      map, dayFirst, existingHashes: existingHashes(),
      walletFor: w => map.wallet ? (walletMap[w] || null) : pw.id,
      fxFor: (cur, date) => { const f = fxRates[cur]; if (f?.mode === 'manual') return +f.rate || 0; if (f?.fn) return f.fn(ymd(date)); return 0; },
      categoryFor: (w, name, type) => {
        const typ = type === 'income' ? 'income' : 'expense';
        const k = `${w}|${typ}|${name || 'Otros'}`; const v = catMap[k];
        if (v && v !== 'new') return v;
        if (!newCats.has(k)) newCats.set(k, { id: uuid(), wallet_id: w, name: (name || 'Otros').slice(0, 60), icon: '🏷️', color: '#8E8E93', kind: typ, sort: 500 + newCats.size, favorite: false, hidden: false, parent_id: null, merged_into: null, created_at: nowIso() });
        return newCats.get(k).id;
      },
      accountFor: a => {
        if (!a) return null; const v = accMap[a]; if (v && v !== 'new') return v;
        if (!newAccs.has(a)) newAccs.set(a, { id: uuid(), name: a.slice(0, 60), type: 'other', icon: '🪙', currency: 'MXN' });
        return newAccs.get(a).id;
      },
    });
    // categorías nuevas con nombre que ya existe pero oculto → reusar
    return { ...res, newCats: [...newCats.values()], newAccs: [...newAccs.values()] };
  }, [step, data, map, dayFirst, walletMap, catMap, accMap, fxRates, S.version]);

  // Monedas extranjeras sin columna de tipo de cambio → tipo de cambio HISTÓRICO por fecha (BCE)
  const foreign = useMemo(() => {
    if (!data || map.fx || map.amount_mxn) return [];
    const m = new Map();
    for (const r of data.rows) {
      const c = (String(r[map.currency] || 'MXN').toUpperCase().match(/[A-Z]{3}/) || ['MXN'])[0]; if (c === 'MXN') continue;
      const d = parseDateSafe(r[map.date], dayFirst); if (!d) continue;
      const x = m.get(c) || { cur: c, n: 0, from: d, to: d }; x.n++; if (d < x.from) x.from = d; if (d > x.to) x.to = d; m.set(c, x);
    }
    return [...m.values()];
  }, [data, map, dayFirst]);
  async function loadHistorical(f) {
    setFxRates(p => ({ ...p, [f.cur]: { mode: 'hist', status: 'Consultando…' } }));
    try {
      const fn = await historicalRates(f.cur, ymd(addDaysSafe(f.from, -7)), ymd(f.to));
      setFxRates(p => ({ ...p, [f.cur]: { mode: 'hist', fn, status: `Histórico BCE por fecha (ej. ${ymd(f.from)}: ${fn(ymd(f.from)).toFixed(4)})` } }));
    } catch (e) {
      setFxRates(p => ({ ...p, [f.cur]: { mode: 'manual', rate: lastKnownRate(f.cur) || '', status: 'Sin conexión al servicio: escribe un tipo de cambio' } }));
    }
  }
  useEffect(() => { if (step === 'preview') foreign.forEach(f => { if (!fxRates[f.cur]) loadHistorical(f); }); }, [step, foreign]);

  async function doImport() {
    if (!plan?.ok.length) return;
    if (!confirmAsk(`¿Importar ${plan.ok.length.toLocaleString('es-MX')} movimientos? Podrás revertirlo completo después.`)) return;
    setBusy(true);
    try {
      for (const a of plan.newAccs) await saveAccount(a);
      const batch = await importTransactions(plan.ok, { filename: file.name, newCategories: plan.newCats });
      setResult({ batch, n: plan.ok.length, dup: plan.duplicates.length, err: plan.errors.length, skip: plan.skipped.length, cats: plan.newCats.length });
      setStep('done');
    } catch (e) { setErr(e.message); } finally { setBusy(false); }
  }

  const walletOpts = [['', 'No importar'], [pw.id, 'Mis gastos'], ...(hw ? [[hw.id, 'Hogar']] : [])];
  return html`<div class="screen">
    <div class="topbar"><button class="iconbtn" onClick=${back}>‹</button><h1>Importar historial</h1></div>
    ${err && html`<div class="err-box" style="margin-bottom:12px">${err}</div>`}

    ${step === 'pick' && html`<div class="card">
      <h3>1. Exporta desde Spendee</h3>
      <div class="small muted">En Spendee: <b>Ajustes → Exportar datos</b> (CSV o Excel) por cada cartera o todas. También funciona con cualquier CSV/Excel con fecha e importe.</div>
      <h3 style="margin-top:16px">2. Elige el archivo</h3>
      <input type="file" accept=".csv,.xlsx,.xls,text/csv" onChange=${onFile} disabled=${busy} />
      ${busy && html`<div class="small muted" style="margin-top:8px">Leyendo…</div>`}
    </div>
    ${batches.length > 0 && html`<div class="section-title">Importaciones anteriores</div><div class="list">${batches.map(b => html`<div class="tx">
      <div class="caticon" style="background:var(--surface2)">📄</div>
      <div class="grow"><div class="t1 ellipsis">${b.filename}</div><div class="t2">${new Date(b.created_at).toLocaleString('es-MX')} · ${b.row_count} movimientos${b.reverted_at ? ' · revertida' : ''}</div></div>
      ${!b.reverted_at && html`<button class="chip" onClick=${async () => { if (confirmAsk(`¿Revertir "${b.filename}"? Se eliminarán sus ${b.row_count} movimientos.`)) { const n = await revertImport(b.id); toast(`${n} movimientos revertidos`); } }}>Revertir</button>`}
    </div>`)}</div>`}`}

    ${step === 'map' && data && html`<div class="card">
      <h3>Columnas (${data.rows.length.toLocaleString('es-MX')} filas en "${file.name}")</h3>
      <div class="small muted" style="margin-bottom:10px">Detecté las columnas automáticamente. Corrige si algo no cuadra.</div>
      ${FIELDS.map(fl => html`<div class="row" style="margin-bottom:8px"><span class="small" style="width:44%">${fl.label}${fl.required ? ' *' : ''}</span>
        <select class="grow" value=${map[fl.key] || ''} onChange=${e => setMap({ ...map, [fl.key]: e.target.value || undefined })}>
          <option value="">— No usar —</option>${data.headers.map(h => html`<option value=${h}>${h}</option>`)}</select></div>`)}
      <div class="field"><span class="lbl">Formato de fecha</span><${Seg} small value=${dayFirst} onChange=${setDayFirst} options=${[[true, 'Día/Mes/Año'], [false, 'Mes/Día/Año']]} /></div>
      <div class="small muted">Ejemplo de la primera fila: <b>${String(data.rows[0][map.date] ?? '')}</b> · <b>${String(data.rows[0][map.amount] ?? '')}</b> · ${String(data.rows[0][map.category] ?? '')}</div>
    </div>
    ${map.wallet && html`<div class="card"><h3>¿A qué cartera va cada cartera de Spendee?</h3>
      ${Object.keys(walletMap).map(w => html`<div class="row" style="margin-bottom:8px"><span class="small grow ellipsis">${w || '(vacío)'}</span>
        <select style="width:50%" value=${walletMap[w]} onChange=${e => setWalletMap({ ...walletMap, [w]: e.target.value })}>${walletOpts.map(([v, l]) => html`<option value=${v}>${l}</option>`)}</select></div>`)}
    </div>`}
    <div class="row"><button class="btn grow" onClick=${() => setStep('pick')}>Atrás</button>
      <button class="btn primary grow" disabled=${!map.date || !map.amount} onClick=${goPreview}>Continuar</button></div>`}

    ${step === 'preview' && plan && html`
      <div class="card"><h3>Revisión</h3>
        <div class="kpis" style="margin-top:0">
          <div class="kpi"><div class="l">Listos</div><div class="v inc">${plan.ok.length.toLocaleString('es-MX')}</div></div>
          <div class="kpi"><div class="l">Duplicados</div><div class="v">${plan.duplicates.length}</div></div>
          <div class="kpi"><div class="l">Con error</div><div class=${'v ' + (plan.errors.length ? 'exp' : '')}>${plan.errors.length}</div></div>
        </div>
        ${plan.skipped.length > 0 && html`<div class="small muted" style="margin-top:8px">${plan.skipped.length} filas omitidas (cartera sin asignar o importe 0).</div>`}
        ${plan.errors.length > 0 && html`<details style="margin-top:8px"><summary class="small exp">Ver errores (no se importarán)</summary>
          <div class="small" style="max-height:160px;overflow:auto">${plan.errors.slice(0, 200).map(e => html`<div>Fila ${e.row}: ${e.msg}</div>`)}</div></details>`}
        ${plan.duplicates.length > 0 && html`<div class="small muted" style="margin-top:6px">Los duplicados (misma fecha, importe, tipo y descripción que algo que ya tienes o repetido en el archivo) se saltan.</div>`}
      </div>
      ${foreign.length > 0 && html`<div class="card"><h3>Moneda extranjera</h3>
        ${foreign.map(f => { const st = fxRates[f.cur] || {}; return html`<div style="margin-bottom:10px"><div class="row between small"><b>${f.cur} · ${f.n} movimientos</b>
          <${Seg} small value=${st.mode || 'hist'} onChange=${v => v === 'hist' ? loadHistorical(f) : setFxRates({ ...fxRates, [f.cur]: { mode: 'manual', rate: st.rate || lastKnownRate(f.cur) || '', status: 'Mismo tipo de cambio para todos' } })} options=${[['hist', 'Histórico'], ['manual', 'Fijo']]} /></div>
          ${st.mode === 'manual' && html`<div class="row small" style="margin-top:6px">1 ${f.cur} = <input style="width:110px" inputmode="decimal" value=${st.rate} onInput=${e => setFxRates({ ...fxRates, [f.cur]: { ...st, rate: e.target.value } })} /> MXN</div>`}
          <div class="tiny muted" style="margin-top:4px">${st.status || ''}</div></div>`; })}
      </div>`}
      <div class="card"><h3>Categorías</h3>
        <div class="small muted" style="margin-bottom:8px">"Crear nueva" conserva el nombre original de Spendee.</div>
        ${catNeeds.map(c => html`<div class="row" style="margin-bottom:8px">
          <span class="small grow ellipsis">${c.name} <span class="faint">(${c.n}) · ${walletLabel(Store.wallets.get(c.w))}${c.typ === 'income' ? ' · ingreso' : ''}</span></span>
          <select style="width:46%" value=${catMap[c.k]} onChange=${e => setCatMap({ ...catMap, [c.k]: e.target.value })}>
            <option value="new">➕ Crear nueva</option>${categoriesOf(c.w, { includeHidden: true, kind: c.typ }).map(x => html`<option value=${x.id}>${x.icon} ${x.name}</option>`)}</select></div>`)}
      </div>
      ${accNeeds.length > 0 && html`<div class="card"><h3>Cuentas</h3>${accNeeds.map(a => html`<div class="row" style="margin-bottom:8px"><span class="small grow">${a}</span>
        <select style="width:46%" value=${accMap[a]} onChange=${e => setAccMap({ ...accMap, [a]: e.target.value })}><option value="new">➕ Crear nueva</option>${myAccounts({ includeHidden: true }).map(x => html`<option value=${x.id}>${x.icon} ${x.name}</option>`)}</select></div>`)}</div>`}
      <div class="card"><h3>Vista previa (primeros 30)</h3>
        <div class="table-wrap"><table class="table"><thead><tr><th>Fecha</th><th>Tipo</th><th>Categoría</th><th class="right">Importe</th><th>Descripción</th></tr></thead>
          <tbody>${plan.ok.slice(0, 30).map(t => html`<tr><td>${new Date(t.occurred_at).toLocaleDateString('es-MX')}</td><td>${TX_TYPES[t.type].short}</td><td>${t._raw_category}</td>
            <td class="right num">${money(t.amount, t.currency)}${t.currency !== 'MXN' ? html`<br/><span class="faint">${money(t.amount_mxn)}</span>` : ''}</td><td>${t.description}</td></tr>`)}</tbody></table></div>
      </div>
      <div class="row"><button class="btn grow" onClick=${() => setStep('map')}>Atrás</button>
        <button class="btn primary grow" disabled=${busy || !plan.ok.length} onClick=${doImport}>${busy ? 'Importando…' : `Importar ${plan.ok.length.toLocaleString('es-MX')}`}</button></div>`}

    ${step === 'done' && result && html`<div class="card center">
      <div style="font-size:44px">✅</div><h3>Importación terminada</h3>
      <div class="small">${result.n.toLocaleString('es-MX')} movimientos importados · ${result.dup} duplicados saltados · ${result.err} con error · ${result.skip} omitidos · ${result.cats} categorías nuevas</div>
      <div class="small muted" style="margin-top:8px">Si algo no te convence, puedes revertir esta importación completa desde esta misma pantalla.</div>
      <button class="btn primary block" style="margin-top:14px" onClick=${() => { setStep('pick'); setData(null); }}>Listo</button>
    </div>`}
  </div>`;
}

// ================= Exportar / Respaldo =================
export function Export({ back }) {
  const S = useStore();
  const pw = personalWallet(), hw = householdWallet();
  const [wallet, setWallet] = useState('both');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [cat, setCat] = useState('');
  const ids = wallet === 'both' ? [pw?.id, hw?.id].filter(Boolean) : [wallet];
  const catNames = [...new Set(ids.flatMap(w => categoriesOf(w, { includeHidden: true })).map(c => c.name))].sort();
  const rows = () => {
    const txs = filterTx(visibleTx(), {
      walletIds: ids, from: from ? new Date(from + 'T00:00:00') : null, to: to ? new Date(new Date(to + 'T00:00:00').getTime() + 864e5) : null,
      categoryIds: cat ? [...S.categories.values()].filter(c => c.name === cat).map(c => c.id) : [],
    }).sort((a, b) => a.occurred_at.localeCompare(b.occurred_at));
    return txs.map(t => {
      const d = new Date(t.occurred_at);
      return {
        Fecha: ymd(d), Hora: d.toTimeString().slice(0, 5), Cartera: walletLabel(S.wallets.get(t.wallet_id)), Tipo: TX_TYPES[t.type]?.short,
        Categoría: S.categories.get(t.category_id)?.name || '', Descripción: t.description, Importe: +t.amount, Moneda: t.currency,
        'Tipo de cambio': +t.fx_rate, 'Importe MXN': (t.type === 'expense' ? -1 : t.type === 'income' || t.type === 'refund' ? 1 : 0) * +t.amount_mxn,
        Cuenta: S.accounts.get(t.account_id)?.name || '', 'Cuenta destino': S.accounts.get(t.to_account_id)?.name || '',
        Etiquetas: (t.tags || []).join(', '), Notas: t.note, 'Registrado por': S.people[t.created_by]?.display_name || (t.created_by === S.user.id ? 'Yo' : ''), ID: t.id,
      };
    });
  };
  const fname = ext => `finanzas_${wallet === 'both' ? 'todo' : walletLabel(S.wallets.get(wallet)).replace(' ', '-')}_${ymd(new Date())}.${ext}`;
  function exportX(kind) {
    const r = rows(); if (!r.length) return toast('No hay movimientos con esos filtros');
    const ws = XLSX().utils.json_to_sheet(r);
    if (kind === 'csv') downloadBlob(new Blob(['﻿' + XLSX().utils.sheet_to_csv(ws)], { type: 'text/csv;charset=utf-8' }), fname('csv'));
    else { const wb = XLSX().utils.book_new(); XLSX().utils.book_append_sheet(wb, ws, 'Movimientos'); downloadBlob(new Blob([XLSX().write(wb, { type: 'array', bookType: 'xlsx' })], { type: 'application/octet-stream' }), fname('xlsx')); }
    toast(`${r.length} movimientos exportados`);
  }
  async function onRestore(e) {
    const f = e.target.files?.[0]; if (!f) return;
    try {
      const data = JSON.parse(await f.text());
      if (!confirmAsk('Restaurar agrega/actualiza los movimientos del respaldo (no borra nada). ¿Continuar?')) return;
      const n = await restoreJson(data); toast(`${n} registros restaurados`);
    } catch (ex) { toast('No se pudo restaurar: ' + ex.message); }
  }
  return html`<div class="screen">
    <div class="topbar"><button class="iconbtn" onClick=${back}>‹</button><h1>Exportar y respaldar</h1></div>
    <div class="card"><h3>Exportar movimientos</h3>
      <div class="field"><${Seg} small value=${wallet} onChange=${setWallet} options=${[['both', 'Todo'], [pw?.id, 'Mis gastos'], ...(hw ? [[hw.id, 'Hogar']] : [])]} /></div>
      <div class="grid2"><div class="field"><label>Desde</label><input type="date" value=${from} onInput=${e => setFrom(e.target.value)} /></div>
        <div class="field"><label>Hasta</label><input type="date" value=${to} onInput=${e => setTo(e.target.value)} /></div></div>
      <div class="field"><label>Categoría</label><select value=${cat} onChange=${e => setCat(e.target.value)}><option value="">Todas</option>${catNames.map(c => html`<option value=${c}>${c}</option>`)}</select></div>
      <div class="row"><button class="btn primary grow" onClick=${() => exportX('xlsx')}>Excel</button><button class="btn grow" onClick=${() => exportX('csv')}>CSV</button></div>
    </div>
    <div class="card"><h3>Respaldo completo</h3>
      <div class="small muted">Un archivo con todo lo tuyo + Hogar (categorías, cuentas, presupuestos, programados y movimientos). Guárdalo en iCloud Drive. Recomendado: 1 vez al mes.</div>
      <button class="btn primary block" style="margin-top:10px" onClick=${() => { downloadBlob(new Blob([JSON.stringify(backupJson())], { type: 'application/json' }), `respaldo_finanzas_${ymd(new Date())}.json`); localStorage.setItem('fh:lastBackup', new Date().toISOString()); toast('Respaldo descargado'); }}>Descargar respaldo</button>
      <div class="field" style="margin-top:14px"><label>Restaurar desde un respaldo</label><input type="file" accept=".json,application/json" onChange=${onRestore} /></div>
      ${localStorage.getItem('fh:lastBackup') && html`<div class="tiny faint">Último respaldo en este dispositivo: ${new Date(localStorage.getItem('fh:lastBackup')).toLocaleDateString('es-MX')}</div>`}
    </div>
  </div>`;
}
