// Shared test harness: serves the site from the repo root and replaces the
// Firebase SDK with a small in-browser fake, so pages run their real code
// against controllable auth/Firestore state without touching any real
// Firebase project. Requires Node 18+ and Playwright (`npm i -g playwright`).
const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium, devices } = require('playwright');

const ROOT = path.resolve(__dirname, '..', '..');
const TYPES = { '.html': 'text/html', '.js': 'application/javascript', '.png': 'image/png', '.css': 'text/css' };

function startServer(){
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      const file = path.join(ROOT, decodeURIComponent(req.url.split('?')[0]));
      if(!file.startsWith(ROOT)){ res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if(err){ res.writeHead(404); return res.end(); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    }).listen(0, '127.0.0.1', () => resolve(server));
  });
}

// Fake Firebase modules. State comes from window.__FAKE_FB (set per test via
// an init script): { user, authDelayMs, readDelayMs, failReads, docs,
// failReadPaths: { 'players/uid': n } (fail the next n single-doc reads) }.
// Every Firestore write is recorded in window.__FAKE_FB_WRITES. Like the
// real rules, an existing leaderboardEntries doc can't be replaced by a
// full setDoc (only its fields updated).
const STUBS = {
  'firebase-app.js': `export const initializeApp = () => ({});`,
  'firebase-auth.js': `
    const cfg = () => window.__FAKE_FB || {};
    const auth = { currentUser: null };
    const mkUser = u => u ? Object.assign({ email: null, metadata: { creationTime: 'Mon, 08 Sep 2026 05:22:20 GMT' }, reload: async () => {} }, u) : null;
    export const getAuth = () => auth;
    // Like Firebase: listeners get the initial state once auth has loaded,
    // and again whenever the signed-in user changes (e.g. anonymous sign-in).
    const listeners = [];
    let initialized = false;
    const notify = () => { window.__FAKE_FB_AUTH_FIRED = (window.__FAKE_FB_AUTH_FIRED || 0) + 1; listeners.forEach(cb => cb(auth.currentUser)); };
    export function onAuthStateChanged(a, cb){
      listeners.push(cb);
      if(initialized){ setTimeout(() => cb(auth.currentUser), 0); }
      else if(listeners.length === 1){
        setTimeout(() => { auth.currentUser = mkUser(cfg().user); initialized = true; notify(); }, cfg().authDelayMs || 0);
      }
      return () => {};
    }
    // Email/password accounts (window.__FAKE_FB.accounts: [{ uid, email, password }]),
    // kept for the tab like the fake database. Signing in persists the user
    // across page loads, as Firebase does.
    const persistCfg = mut => { try{ const c = JSON.parse(sessionStorage.getItem('__fake_fb') || '{}'); mut(c); sessionStorage.setItem('__fake_fb', JSON.stringify(c)); }catch(e){} };
    const accounts = () => (window.__FAKE_FB.accounts = window.__FAKE_FB.accounts || []);
    const setUser = u => { auth.currentUser = mkUser(u); window.__FAKE_FB.user = u; persistCfg(c => { c.user = u; c.accounts = accounts(); }); setTimeout(notify, 0); return { user: auth.currentUser }; };
    const authError = code => Object.assign(new Error(code), { code });
    export async function signOut(){ auth.currentUser = null; window.__FAKE_FB.user = null; persistCfg(c => { c.user = null; }); notify(); }
    export async function signInAnonymously(){ auth.currentUser = mkUser({ uid: 'anon1', isAnonymous: true }); setTimeout(notify, 0); return { user: auth.currentUser }; }
    export async function signInWithEmailAndPassword(a, email, password){
      const acct = accounts().find(x => x.email === String(email).trim().toLowerCase());
      if(!acct || acct.password !== password) throw authError('auth/invalid-credential');
      return setUser({ uid: acct.uid, email: acct.email, isAnonymous: false });
    }
    export async function createUserWithEmailAndPassword(a, email, password){
      const e = String(email).trim().toLowerCase();
      if(accounts().some(x => x.email === e)) throw authError('auth/email-already-in-use');
      const acct = { uid: 'u' + (accounts().length + 1) + '_' + e.replace(/[^a-z0-9]/g, '').slice(0, 8), email: e, password };
      accounts().push(acct);
      return setUser({ uid: acct.uid, email: acct.email, isAnonymous: false });
    }
    // Records every reset request (the address it went to) in sessionStorage.
    export async function sendPasswordResetEmail(a, email){
      const sent = JSON.parse(sessionStorage.getItem('__fake_resets') || '[]'); sent.push(email); sessionStorage.setItem('__fake_resets', JSON.stringify(sent));
    }
    export async function updatePassword(user, password){
      const acct = accounts().find(x => x.uid === user.uid); if(acct){ acct.password = password; persistCfg(c => { c.accounts = accounts(); }); }
    }
    export async function verifyBeforeUpdateEmail(){}
    export async function deleteUser(){}
  `,
  'firebase-firestore.js': `
    const cfg = () => window.__FAKE_FB || {};
    const store = () => (window.__FAKE_FB.docs = window.__FAKE_FB.docs || {});
    const writes = () => (window.__FAKE_FB_WRITES = window.__FAKE_FB_WRITES || []);
    // Persist the fake database across page loads in this tab, like Firestore.
    const persist = () => { try{ const c = JSON.parse(sessionStorage.getItem('__fake_fb') || '{}'); c.docs = store(); sessionStorage.setItem('__fake_fb', JSON.stringify(c)); }catch(e){} };
    const wait = () => new Promise(r => setTimeout(r, cfg().readDelayMs || 0));
    const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    export const getFirestore = () => ({});
    export const doc = (db, col, id) => ({ path: col + '/' + id });
    export const collection = (db, col) => ({ col });
    // Queries run against the stored docs of that collection: '==' filters,
    // orderBy and limit are honoured (enough for the pages under test).
    export const where = (field, op, value) => ({ where: { field, op, value } });
    export const orderBy = (field, dir) => ({ orderBy: { field, dir: dir || 'asc' } });
    export const limit = (n) => ({ limit: n });
    export const query = (c, ...constraints) => ({ col: c.col, constraints });
    // Every read is logged (window.__FAKE_FB_READS) so tests can check which
    // documents a flow looked at.
    const reads = () => (window.__FAKE_FB_READS = window.__FAKE_FB_READS || []);
    async function read(ref){
      reads().push(ref.path);
      await wait();
      if(cfg().failReads) throw new Error('fake network failure');
      const fp = cfg().failReadPaths;
      if(fp && fp[ref.path] > 0){ fp[ref.path]--; throw new Error('fake read failure for ' + ref.path); }
      const d = clone(store()[ref.path]);
      return { exists: () => d !== undefined, data: () => d, id: ref.path.split('/')[1] };
    }
    export const getDoc = read;
    export const getDocFromServer = read;
    export async function getDocs(q){
      reads().push('query:' + (q && q.col));
      await wait();
      if(cfg().failReads) throw new Error('fake network failure');
      const cs = (q && q.constraints) || [];
      let rows = Object.entries(store())
        .filter(([path]) => q && q.col && path.startsWith(q.col + '/') && path.split('/').length === 2)
        .map(([path, data]) => ({ id: path.split('/')[1], data: clone(data) }));
      for(const c of cs) if(c.where && c.where.op === '==') rows = rows.filter(r => r.data[c.where.field] === c.where.value);
      for(const c of cs) if(c.orderBy) rows.sort((a, b) => (a.data[c.orderBy.field] > b.data[c.orderBy.field] ? 1 : -1) * (c.orderBy.dir === 'desc' ? -1 : 1));
      for(const c of cs) if(c.limit) rows = rows.slice(0, c.limit);
      const docs = rows.map(r => ({ id: r.id, data: () => r.data, ref: { path: q.col + '/' + r.id } }));
      return { empty: docs.length === 0, docs, size: docs.length, forEach(fn){ docs.forEach(fn); } };
    }
    export const deleteField = () => ({ __fakeDeleteField: true });
    const applyDeletes = o => { for(const k of Object.keys(o)) if(o[k] && o[k].__fakeDeleteField) delete o[k]; return o; };
    export async function setDoc(ref, data, opts){
      if(ref.path.startsWith('leaderboardEntries/') && store()[ref.path] !== undefined && !(opts && opts.merge)){
        throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      }
      writes().push({ path: ref.path, data: clone(data), merge: !!(opts && opts.merge), at: Date.now() });
      store()[ref.path] = applyDeletes((opts && opts.merge) ? Object.assign({}, store()[ref.path] || {}, clone(data)) : clone(data));
      persist();
    }
    export async function addDoc(c, data){ writes().push({ path: c.col + '/(new)', data: clone(data) }); return { id: 'x' }; }
    export async function deleteDoc(ref){ writes().push({ path: ref.path, deleted: true }); delete store()[ref.path]; persist(); }
    export function writeBatch(){
      const ops = [];
      return { update(ref, data){ ops.push([ref, data]); }, set(ref, data, o){ ops.push([ref, data, o]); },
        async commit(){ for(const [ref, data] of ops){ writes().push({ path: ref.path, data: clone(data), merge: true, batch: true }); store()[ref.path] = Object.assign({}, store()[ref.path] || {}, clone(data)); } persist(); } };
    }
  `,
};

async function newPage(browser, { fake = {}, localStorage = {}, mobile = false, now } = {}){
  const ctx = await browser.newContext(mobile ? { ...devices[typeof mobile === 'string' ? mobile : 'iPhone 13'] } : { viewport: { width: 1200, height: 900 } });
  await ctx.route(/gstatic\.com\/firebasejs\/[^/]+\/(firebase-[a-z]+\.js)/, route => {
    const name = route.request().url().match(/(firebase-[a-z]+\.js)/)[1];
    route.fulfill({ status: 200, contentType: 'application/javascript', body: STUBS[name] || 'export {}' });
  });
  await ctx.route(/googletagmanager|fonts\.googleapis|fonts\.gstatic/, route => route.abort());
  // Seed state once per context (not on every navigation), so reloads and
  // page-to-page navigation behave like a real returning browser.
  await ctx.addInitScript(([fakeCfg, ls]) => {
    if(!sessionStorage.getItem('__seeded')){
      sessionStorage.setItem('__seeded', '1');
      for(const [k, v] of Object.entries(ls)) localStorage.setItem(k, v);
      sessionStorage.setItem('__fake_fb', JSON.stringify(fakeCfg));
    }
    window.__FAKE_FB = JSON.parse(sessionStorage.getItem('__fake_fb'));
  }, [fake, localStorage]);
  const page = await ctx.newPage();
  if(now) await page.clock.install({ time: now });
  return { ctx, page };
}

// Today's / relative puzzle dates in US Eastern time, matching the game.
function etDate(offsetDays = 0, base = new Date()){
  const today = base.toLocaleDateString('en-CA', { timeZone: 'America/New_York' });
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + offsetDays));
  return dt.toISOString().slice(0, 10);
}

// Minimal test runner: prints PASS/FAIL per case, exits non-zero on failure.
async function run(title, cases){
  const server = await startServer();
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch();
  let failed = 0;
  console.log(`\n${title}`);
  for(const [name, fn] of cases){
    try{
      await fn({ browser, base });
      console.log(`  PASS  ${name}`);
    }catch(e){
      failed++;
      console.log(`  FAIL  ${name}\n        ${String(e && e.message || e).split('\n').join('\n        ')}`);
    }
  }
  await browser.close();
  server.close();
  console.log(`  ${cases.length - failed}/${cases.length} passed`);
  return failed;
}

function assertEqual(actual, expected, label){
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if(a !== e) throw new Error(`${label}: expected ${e}, got ${a}`);
}

module.exports = { newPage, run, assertEqual, etDate };
