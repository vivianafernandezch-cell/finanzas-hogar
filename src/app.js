import { html, render, useState, useEffect } from '../vendor/preact-htm.js';
import { init, S, subscribe, householdWallet, syncNow, prefs } from './store.js';
import { cloudConfigured, auth, remote } from './cloud.js';
import { Toaster, useStore } from './ui/common.js';
import { AddSheet } from './ui/add.js';
import { Home } from './ui/home.js';
import { History } from './ui/history.js';
import { Stats, Insights, Trips, Trip } from './ui/stats.js';
import { Budgets, More, Accounts, Categories, Recurring, Settings } from './ui/manage.js';
import { Import, Export } from './ui/dataio.js';
import { CashBox, Handovers } from './ui/extras.js';

// Tema guardado
const theme = prefs.get('theme', 'auto');
if (theme !== 'auto') document.documentElement.setAttribute('data-theme', theme);

const TABS = [['home', '🏠', 'Inicio'], ['history', '🧾', 'Historial'], ['stats', '📊', 'Gráficas'], ['budgets', '🎯', 'Presup.']];
const ROOT_TABS = ['home', 'history', 'stats', 'budgets', 'more'];

function Shell() {
  const S = useStore();
  const [route, setRoute] = useState({ name: 'home' });
  const [stack, setStack] = useState([]);
  const [sheet, setSheetRaw] = useState(null);    // { editing?, draft?, wallet?, k }
  const setSheet = o => setSheetRaw(o ? { ...o, k: Date.now() } : null);

  const go = (name, params = {}) => {
    if (ROOT_TABS.includes(name)) { setStack([]); setRoute({ name, ...params }); }
    else { setStack(s => [...s, route]); setRoute({ name, ...params }); }
    window.scrollTo(0, 0);
  };
  const back = () => { setStack(s => { const n = [...s]; const prev = n.pop() || { name: 'more' }; setRoute(prev); return n; }); };
  const openTx = t => setSheet({ editing: t });

  useEffect(() => {
    const onAdd = e => setSheet({ wallet: e.detail?.wallet, account: e.detail?.account });
    const onEdit = e => setSheet(e.detail.isNew ? { editing: null, draft: e.detail.tx } : { editing: e.detail.tx });
    window.addEventListener('fh:add', onAdd); window.addEventListener('fh:edit', onEdit);
    // Atajo: /?add=1 (para un atajo de iPhone en la pantalla de inicio)
    if (new URLSearchParams(location.search).get('add')) setSheet({});
    return () => { window.removeEventListener('fh:add', onAdd); window.removeEventListener('fh:edit', onEdit); };
  }, []);

  const r = route.name;
  const props = { go, back, openTx };
  let screen;
  switch (r) {
    case 'home': screen = html`<${Home} ...${props} />`; break;
    case 'history': screen = html`<${History} ...${props} initial=${route.filter} />`; break;
    case 'stats': screen = html`<${Stats} ...${props} />`; break;
    case 'budgets': screen = html`<${Budgets} ...${props} />`; break;
    case 'more': screen = html`<${More} ...${props} />`; break;
    case 'insights': screen = html`<${Insights} ...${props} />`; break;
    case 'trips': screen = html`<${Trips} ...${props} />`; break;
    case 'trip': screen = html`<${Trip} ...${props} tag=${route.tag} />`; break;
    case 'accounts': screen = html`<${Accounts} ...${props} />`; break;
    case 'categories': screen = html`<${Categories} ...${props} />`; break;
    case 'recurring': screen = html`<${Recurring} ...${props} />`; break;
    case 'import': screen = html`<${Import} ...${props} />`; break;
    case 'export': screen = html`<${Export} ...${props} />`; break;
    case 'cashbox': screen = html`<${CashBox} ...${props} />`; break;
    case 'handovers': screen = html`<${Handovers} ...${props} />`; break;
    case 'settings': screen = html`<${Settings} ...${props} onSignOut=${signOut} />`; break;
    default: screen = html`<${Home} ...${props} />`;
  }
  const tabOf = ROOT_TABS.includes(r) ? r : 'more';
  return html`<div>
    ${screen}
    <nav class="tabbar" aria-label="Navegación">
      ${TABS.map(t => html`<button class=${tabOf === t[0] ? 'on' : ''} onClick=${() => go(t[0])}><span class="ic">${t[1]}</span>${t[2]}</button>`)}
      <button class=${tabOf === 'more' ? 'on' : ''} onClick=${() => go('more')}><span class="ic">☰</span>Más</button>
    </nav>
    <button class="fab" aria-label="Agregar movimiento" onClick=${() => setSheet({})}>+</button>
    ${sheet && html`<${AddSheet} key=${sheet.k} editing=${sheet.editing || null} draft=${sheet.draft || null}
      presetWallet=${sheet.wallet} presetAccount=${sheet.account} onClose=${() => setSheet(null)} />`}
    <${Toaster} />
  </div>`;
}

// ---------- Login (solo si hay nube configurada) ----------
function Login({ onDone }) {
  const [email, setEmail] = useState(''); const [pass, setPass] = useState('');
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false); const [info, setInfo] = useState('');
  async function submit(e) {
    e.preventDefault(); setErr(''); setBusy(true);
    try { await auth.signIn(email.trim(), pass); onDone(); }
    catch (ex) { setErr(/invalid/i.test(ex.message) ? 'Correo o contraseña incorrectos' : ex.message); }
    finally { setBusy(false); }
  }
  return html`<form class="login" onSubmit=${submit}>
    <div class="logo">🐚</div>
    <h1 class="center" style="margin:0">Finanzas Hogar</h1>
    <p class="center muted" style="margin:0 0 10px">Tus gastos y los de la casa, en segundos.</p>
    <input type="email" placeholder="Correo" autocomplete="username" value=${email} onInput=${e => setEmail(e.target.value)} required />
    <input type="password" placeholder="Contraseña" autocomplete="current-password" value=${pass} onInput=${e => setPass(e.target.value)} required />
    ${err && html`<div class="err-box">${err}</div>`}${info && html`<div class="ok-box">${info}</div>`}
    <button class="btn primary block" disabled=${busy}>${busy ? 'Entrando…' : 'Entrar'}</button>
    <button type="button" class="link small" onClick=${async () => { if (!email) return setErr('Escribe tu correo primero'); try { await auth.resetPassword(email.trim()); setInfo('Te enviamos un correo para cambiar tu contraseña.'); } catch (ex) { setErr(ex.message); } }}>¿Olvidaste tu contraseña?</button>
  </form>`;
}

// ---------- Primer ingreso: unirse o crear Hogar ----------
function HouseholdOnboarding({ onDone }) {
  const [code, setCode] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const run = async fn => { setBusy(true); setErr(''); try { await fn(); await syncNow(); onDone(); } catch (e) { setErr(e.message); } finally { setBusy(false); } };
  return html`<div class="login">
    <div class="logo">🏠</div><h2 class="center" style="margin:0">Configura Hogar</h2>
    <p class="center muted small">Hogar es la cartera que compartes con tu pareja. Se hace una sola vez.</p>
    <div class="card"><b>¿Eres la primera en entrar?</b>
      <div class="small muted" style="margin:4px 0 10px">Crea Hogar. Después, en Más → Ajustes, verás el código para invitar a tu pareja.</div>
      <button class="btn primary block" disabled=${busy} onClick=${() => run(() => remote.createHousehold())}>Crear Hogar</button></div>
    <div class="card"><b>¿Te pasaron un código?</b>
      <div class="small muted" style="margin:4px 0 10px">Escríbelo para unirte al Hogar que ya existe.</div>
      <div class="row"><input placeholder="Código de 8 letras" value=${code} onInput=${e => setCode(e.target.value.toUpperCase())} /><button class="btn" disabled=${busy || code.length < 4} onClick=${() => run(() => remote.joinHousehold(code))}>Unirme</button></div></div>
    <button class="link small" onClick=${onDone}>Ahora no</button>
    ${err && html`<div class="err-box">${err}</div>`}
  </div>`;
}

function Root() {
  const [phase, setPhase] = useState('loading');  // loading | login | onboarding | app | error
  const [err, setErr] = useState('');
  async function start() {
    try {
      if (!cloudConfigured) {
        await init({ mode: 'local', user: { id: 'local', name: 'Yo' } });
        setPhase('app'); return;
      }
      const session = await auth.session();
      if (!session) { setPhase('login'); return; }
      const u = session.user;
      await init({ mode: 'cloud', user: { id: u.id, email: u.email, name: u.user_metadata?.name || u.email.split('@')[0] } });
      await syncNow();
      setPhase(!householdWallet() && !prefs.get('skipHousehold:' + u.id) && navigator.onLine ? 'onboarding' : 'app');
    } catch (e) { console.error(e); setErr(e.message || String(e)); setPhase('error'); }
  }
  useEffect(() => { start(); }, []);
  if (phase === 'loading') return html`<div class="login"><div class="logo">🐚</div></div>`;
  if (phase === 'error') return html`<div class="login"><div class="logo">⚠️</div><div class="err-box">${err}</div><button class="btn" onClick=${() => location.reload()}>Reintentar</button></div>`;
  if (phase === 'login') return html`<${Login} onDone=${() => { setPhase('loading'); start(); }} />`;
  if (phase === 'onboarding') return html`<${HouseholdOnboarding} onDone=${() => { prefs.set('skipHousehold:' + S.user.id, true); setPhase('app'); }} />`;
  return html`<${Shell} />`;
}

export async function signOut() {
  if (S.sync.pending && !confirm(`Tienes ${S.sync.pending} cambio(s) sin subir. Si cierras sesión se quedan guardados en este teléfono y se subirán cuando vuelvas a entrar. ¿Cerrar sesión?`)) return;
  await auth.signOut(); location.reload();
}

render(html`<${Root} />`, document.getElementById('app'));

// Service worker (offline)
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('./sw.js').catch(e => console.warn('SW', e));
}
