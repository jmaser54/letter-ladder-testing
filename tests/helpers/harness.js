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
// an init script): { user, authDelayMs, readDelayMs, failReads, docs }.
// Every Firestore write is recorded in window.__FAKE_FB_WRITES.
const STUBS = {
  'firebase-app.js': `export const initializeApp = () => ({});`,
  'firebase-auth.js': `
    const cfg = () => window.__FAKE_FB || {};
    const auth = { currentUser: null };
    const mkUser = u => u ? Object.assign({ email: null, reload: async () => {} }, u) : null;
    export const getAuth = () => auth;
    export function onAuthStateChanged(a, cb){
      setTimeout(() => { auth.currentUser = mkUser(cfg().user); window.__FAKE_FB_AUTH_FIRED = (window.__FAKE_FB_AUTH_FIRED || 0) + 1; cb(auth.currentUser); }, cfg().authDelayMs || 0);
      return () => {};
    }
    export async function signOut(){ auth.currentUser = null; }
    export async function signInAnonymously(){ auth.currentUser = mkUser({ uid: 'anon1', isAnonymous: true }); return { user: auth.currentUser }; }
    export async function signInWithEmailAndPassword(){ throw Object.assign(new Error('fake'), { code: 'auth/invalid-credential' }); }
    export async function createUserWithEmailAndPassword(){ throw Object.assign(new Error('fake'), { code: 'auth/operation-not-allowed' }); }
    export async function sendPasswordResetEmail(){}
  `,
  'firebase-firestore.js': `
    const cfg = () => window.__FAKE_FB || {};
    const store = () => (window.__FAKE_FB.docs = window.__FAKE_FB.docs || {});
    const writes = () => (window.__FAKE_FB_WRITES = window.__FAKE_FB_WRITES || []);
    const wait = () => new Promise(r => setTimeout(r, cfg().readDelayMs || 0));
    const clone = v => v === undefined ? undefined : JSON.parse(JSON.stringify(v));
    export const getFirestore = () => ({});
    export const doc = (db, col, id) => ({ path: col + '/' + id });
    export const collection = (db, col) => ({ col });
    export const where = () => ({}); export const orderBy = () => ({}); export const limit = () => ({});
    export const query = (c) => c;
    async function read(ref){
      await wait();
      if(cfg().failReads) throw new Error('fake network failure');
      const d = clone(store()[ref.path]);
      return { exists: () => d !== undefined, data: () => d, id: ref.path.split('/')[1] };
    }
    export const getDoc = read;
    export const getDocFromServer = read;
    export async function getDocs(){ await wait(); return { empty: true, docs: [], forEach(){} }; }
    export async function setDoc(ref, data, opts){
      writes().push({ path: ref.path, data: clone(data), merge: !!(opts && opts.merge), at: Date.now() });
      store()[ref.path] = (opts && opts.merge) ? Object.assign({}, store()[ref.path] || {}, clone(data)) : clone(data);
    }
    export async function addDoc(c, data){ writes().push({ path: c.col + '/(new)', data: clone(data) }); return { id: 'x' }; }
    export async function deleteDoc(ref){ writes().push({ path: ref.path, deleted: true }); }
  `,
};

async function newPage(browser, { fake = {}, localStorage = {}, mobile = false, now } = {}){
  const ctx = await browser.newContext(mobile ? { ...devices['iPhone 13'] } : { viewport: { width: 1200, height: 900 } });
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
