// Sign-in email protection: a real sign-in email is stored in the players
// document only encrypted with the player's password (email-crypto.js), so a
// username lookup reveals no email. Covers sign-up, login by username (encrypted,
// plain-text, synthetic), login with a typed email, wrong passwords, the
// typed-email password reset (no document reads), re-encryption after a reset
// or a password change, and migration of plain-text emails on sign-in.
const { newPage, run, assertEqual } = require('./helpers/harness');

const DAY = '2026-11-12';
const NOW = new Date(DAY + 'T12:00:05-05:00');
const EMAIL = 'jeff.real@example.com';
const LS = { 'letterladder:howToPlaySeen': '1', 'letterladder:timerChoice': 'timed', 'letterladder:timerChoiceMade': '1', 'letterladder:lastViewedDateKey': DAY };

const realAcct = (password = 'secret123') => ({ uid: 'jeffuid', email: EMAIL, password });
const playersDoc = extra => ({ 'players/jeffuid': { username: 'JeffTest', usernameLower: 'jefftest', createdAt: 1788844940627, leaderboardVisible: true, ...extra } });

async function open(browser, base, { accounts = [], docs = {}, ls = LS } = {}){
  const { ctx, page } = await newPage(browser, { fake: { user: null, accounts, docs }, localStorage: ls, now: NOW });
  const logs = []; page.on('console', m => { if(/\[account\]/.test(m.text())) logs.push(m.text()); });
  return { ctx, page, logs };
}
const db = page => page.evaluate(() => window.__FAKE_FB.docs || {});
const signedIn = page => page.evaluate(() => (window.__FAKE_FB.user || {}).uid || null);
// Decrypt in the page with the real module (WebCrypto), as the login does.
const decrypt = (page, blob, password, uid = 'jeffuid') => page.evaluate(async ([b, p, u]) => (await import('/email-crypto.js?v=1')).decryptEmail(b, p, u), [blob, password, uid]);
const encrypt = (page, email, password, uid = 'jeffuid') => page.evaluate(async ([e, p, u]) => (await import('/email-crypto.js?v=1')).encryptEmail(e, p, u), [email, password, uid]);

// Home page log in / create account through the real UI.
async function homeAuth(page, base, mode, { username, password, email }){
  await page.goto(base + '/index.html'); await page.waitForSelector('#account-icon-btn', { timeout: 10000 });
  await page.click('#account-icon-btn'); await page.click(mode === 'login' ? '#dd-login' : '#dd-create');
  await page.fill('#auth-username', username); await page.fill('#auth-password', password);
  if(email !== undefined) await page.fill('#auth-email', email);
  await page.click('#auth-submit');
  await page.waitForFunction(() => localStorage.getItem('letterladder:accountUsername') || (document.getElementById('auth-error') || {}).textContent, null, { timeout: 15000 });
  return page.evaluate(() => ({ username: localStorage.getItem('letterladder:accountUsername'), error: (document.getElementById('auth-error') || {}).textContent || '' }));
}
async function gameReady(page, base){
  await page.goto(base + '/game.html');
  await page.waitForFunction(() => typeof accountScopeReady !== 'undefined' && accountScopeReady === true && window.LetterLadderAuth, null, { timeout: 15000 });
}
const noEmailIn = (obj, email = EMAIL) => { const j = JSON.stringify(obj).toLowerCase(); return !j.includes(email.toLowerCase()) && !j.includes(email.split('@')[0].toLowerCase()) && !j.includes('@example.com'); };

module.exports = run('Account sign-in email (encrypted)', [
  ['sign-up with a real email (home page): players doc holds only an encrypted copy; Auth account and recovery keep the real email', async ({ browser, base }) => {
    const { ctx, page } = await open(browser, base);
    const r = await homeAuth(page, base, 'create', { username: 'NewPlayer', password: 'hunter22', email: 'New.Player@Example.com' });
    assertEqual([r.username, r.error], ['NewPlayer', ''], 'account created');
    const d = await db(page); const accts = await page.evaluate(() => window.__FAKE_FB.accounts);
    const uid = accts[0].uid, pdoc = d[`players/${uid}`];
    assertEqual([accts[0].email, pdoc.authEmail, typeof pdoc.authEmailEnc, d[`playerRecovery/${uid}`].recoveryEmail], ['new.player@example.com', undefined, 'object', 'New.Player@Example.com'], 'where the email lives');
    assertEqual(noEmailIn(pdoc, 'new.player@example.com'), true, `players doc reveals no email: ${JSON.stringify(pdoc)}`);
    assertEqual([await decrypt(page, pdoc.authEmailEnc, 'hunter22', uid), await decrypt(page, pdoc.authEmailEnc, 'wrong-guess', uid), pdoc.authEmailEnc.iter >= 600000], ['new.player@example.com', null, true], 'decrypts only with the password');
    await ctx.close();
  }],
  ['sign-up without an email (game page): synthetic sign-in address in plain text, exactly as before', async ({ browser, base }) => {
    const { ctx, page } = await open(browser, base);
    await gameReady(page, base);
    const r = await page.evaluate(() => window.LetterLadderAuth.createAccount('PlainUser', 'pw123456', ''));
    const d = await db(page);
    assertEqual([r.success, d[`players/${r.uid}`].authEmail, d[`players/${r.uid}`].authEmailEnc, !!d[`playerRecovery/${r.uid}`]], [true, 'plainuser@players.letterladder.io', undefined, false], 'synthetic account');
    await ctx.close();
  }],
  ['sign-up with a real email (game page): only an encrypted copy', async ({ browser, base }) => {
    const { ctx, page } = await open(browser, base);
    await gameReady(page, base);
    const r = await page.evaluate(() => window.LetterLadderAuth.createAccount('GamePlayer', 'pw123456', 'gamer@example.com'));
    const pdoc = (await db(page))[`players/${r.uid}`];
    assertEqual([r.success, pdoc.authEmail, noEmailIn(pdoc, 'gamer@example.com'), await decrypt(page, pdoc.authEmailEnc, 'pw123456', r.uid)], [true, undefined, true, 'gamer@example.com'], 'encrypted only');
    await ctx.close();
  }],
  ['login by username with an encrypted email works (home page and game page)', async ({ browser, base }) => {
    for(const where of ['home', 'game']){
      const { ctx, page } = await open(browser, base, { accounts: [realAcct()] });
      const blob = await (async () => { await page.goto(base + '/about.html'); return encrypt(page, EMAIL, 'secret123'); })();
      await page.evaluate(b => { window.__FAKE_FB.docs['players/jeffuid'] = { username: 'JeffTest', usernameLower: 'jefftest', createdAt: 1, authEmailEnc: b }; const c = JSON.parse(sessionStorage.getItem('__fake_fb')); c.docs = window.__FAKE_FB.docs; sessionStorage.setItem('__fake_fb', JSON.stringify(c)); }, blob);
      let ok;
      if(where === 'home') ok = (await homeAuth(page, base, 'login', { username: 'JeffTest', password: 'secret123' })).username === 'JeffTest';
      else { await gameReady(page, base); ok = (await page.evaluate(() => window.LetterLadderAuth.login('JeffTest', 'secret123'))).username === 'JeffTest'; }
      assertEqual([ok, await signedIn(page)], [true, 'jeffuid'], `${where} page`);
      await ctx.close();
    }
  }],
  ['login with a typed email address signs in directly - no players lookup first', async ({ browser, base }) => {
    const { ctx, page } = await open(browser, base, { accounts: [realAcct()], docs: playersDoc({ authEmail: EMAIL }) });
    await page.goto(base + '/index.html'); await page.waitForSelector('#account-icon-btn');
    await page.evaluate(() => { window.__FAKE_FB_READS = []; });
    await page.click('#account-icon-btn'); await page.click('#dd-login');
    await page.fill('#auth-username', EMAIL.toUpperCase()); await page.fill('#auth-password', 'secret123'); await page.click('#auth-submit');
    await page.waitForFunction(() => localStorage.getItem('letterladder:accountUsername'), null, { timeout: 15000 });
    const reads = await page.evaluate(() => window.__FAKE_FB_READS);
    assertEqual([await page.evaluate(() => localStorage.getItem('letterladder:accountUsername')), reads.includes('query:players')], ['JeffTest', false], `signed in by email; reads ${JSON.stringify(reads)}`);
    await ctx.close();
  }],
  ['wrong password with a valid username fails (encrypted and synthetic accounts)', async ({ browser, base }) => {
    const { ctx, page } = await open(browser, base, { accounts: [realAcct(), { uid: 'synuid', email: 'syn@players.letterladder.io', password: 'right1' }], docs: { 'players/synuid': { username: 'Syn', usernameLower: 'syn', authEmail: 'syn@players.letterladder.io' } } });
    await page.goto(base + '/about.html');
    const blob = await encrypt(page, EMAIL, 'secret123');
    await page.evaluate(b => { window.__FAKE_FB.docs['players/jeffuid'] = { username: 'JeffTest', usernameLower: 'jefftest', authEmailEnc: b }; const c = JSON.parse(sessionStorage.getItem('__fake_fb')); c.docs = window.__FAKE_FB.docs; sessionStorage.setItem('__fake_fb', JSON.stringify(c)); }, blob);
    const enc = await homeAuth(page, base, 'login', { username: 'JeffTest', password: 'not-it' });
    assertEqual([enc.username, /incorrect/i.test(enc.error), await signedIn(page)], [null, true, null], `encrypted account: "${enc.error}"`);
    await gameReady(page, base);
    const syn = await page.evaluate(() => window.LetterLadderAuth.login('Syn', 'wrong'));
    assertEqual([syn.success, await signedIn(page)], [false, null], 'synthetic account');
    await ctx.close();
  }],
  ['signed-out read of a players document reveals no email (after sign-up, migration and re-encryption)', async ({ browser, base }) => {
    const { ctx, page } = await open(browser, base, { accounts: [realAcct()], docs: playersDoc({ authEmail: EMAIL }) });
    assertEqual(noEmailIn((await (async () => { await page.goto(base + '/about.html'); return db(page); })())['players/jeffuid']), false, 'before: plain-text email is readable (the leak)');
    await gameReady(page, base);
    await page.evaluate(() => window.LetterLadderAuth.login('JeffTest', 'secret123'));
    const pdoc = (await db(page))['players/jeffuid'];
    assertEqual([noEmailIn(pdoc), Object.keys(pdoc).sort()], [true, ['authEmailEnc', 'createdAt', 'leaderboardVisible', 'username', 'usernameLower']], `after: ${JSON.stringify(pdoc)}`);
    await ctx.close();
  }],
  ['migration: a plain-text real email is replaced by an encrypted copy on sign-in (home and game page)', async ({ browser, base }) => {
    for(const where of ['home', 'game']){
      const { ctx, page, logs } = await open(browser, base, { accounts: [realAcct()], docs: playersDoc({ authEmail: EMAIL }) });
      if(where === 'home') await homeAuth(page, base, 'login', { username: 'JeffTest', password: 'secret123' });
      else { await gameReady(page, base); await page.evaluate(() => window.LetterLadderAuth.login('JeffTest', 'secret123')); }
      const pdoc = (await db(page))['players/jeffuid'];
      assertEqual([pdoc.authEmail, await decrypt(page, pdoc.authEmailEnc, 'secret123'), logs.some(l => /migrated plain-text email to encrypted/.test(l))], [undefined, EMAIL, true], `${where}: migrated`);
      // a second sign-in leaves the up-to-date copy alone
      const before = JSON.stringify(pdoc.authEmailEnc);
      await page.evaluate(() => window.__FAKE_FB_WRITES = []);
      if(where === 'game') await page.evaluate(() => window.LetterLadderAuth.login('JeffTest', 'secret123'));
      else {
        // sign out first (the signed-in menu has no "Log in"), then log in again
        await page.evaluate(() => { const c = JSON.parse(sessionStorage.getItem('__fake_fb')); c.user = null; sessionStorage.setItem('__fake_fb', JSON.stringify(c)); localStorage.removeItem('letterladder:accountUsername'); });
        await homeAuth(page, base, 'login', { username: 'JeffTest', password: 'secret123' });
      }
      assertEqual(JSON.stringify((await db(page))['players/jeffuid'].authEmailEnc), before, `${where}: not rewritten when up to date`);
      await ctx.close();
    }
  }],
  ['password reset: sent to the typed email with no document reads; next sign-in by email re-encrypts with the new password', async ({ browser, base }) => {
    const { ctx, page, logs } = await open(browser, base, { accounts: [realAcct()] });
    await page.goto(base + '/about.html');
    const blob = await encrypt(page, EMAIL, 'secret123');
    await page.evaluate(b => { window.__FAKE_FB.docs['players/jeffuid'] = { username: 'JeffTest', usernameLower: 'jefftest', authEmailEnc: b }; const c = JSON.parse(sessionStorage.getItem('__fake_fb')); c.docs = window.__FAKE_FB.docs; sessionStorage.setItem('__fake_fb', JSON.stringify(c)); }, blob);
    // home page reset form
    await page.goto(base + '/index.html'); await page.waitForSelector('#account-icon-btn');
    await page.click('#account-icon-btn'); await page.click('#dd-login'); await page.click('#auth-forgot');
    await page.evaluate(() => { window.__FAKE_FB_READS = []; });
    await page.fill('#reset-email', EMAIL); await page.click('#reset-submit');
    await page.waitForFunction(() => /Check your email/.test(document.body.textContent) && JSON.parse(sessionStorage.getItem('__fake_resets') || '[]').length > 0, null, { timeout: 10000 });
    const r1 = await page.evaluate(() => ({ sent: JSON.parse(sessionStorage.getItem('__fake_resets') || '[]'), reads: window.__FAKE_FB_READS }));
    assertEqual([r1.sent, r1.reads], [[EMAIL], []], 'home reset: typed email, no reads');
    // an address with no account still says "check your email" (doesn't reveal anything)
    await gameReady(page, base);
    await page.evaluate(() => { window.__FAKE_FB_READS = []; });
    const g = await page.evaluate(() => Promise.all([window.LetterLadderAuth.requestPasswordReset('nobody@example.com'), window.LetterLadderAuth.requestPasswordReset('not-an-email')]));
    assertEqual([g[0].success, g[1].success, await page.evaluate(() => window.__FAKE_FB_READS)], [true, false, []], 'game reset: typed email only, no reads');
    // the player follows the link and sets a new password (Firebase changes it)
    await page.evaluate(() => { window.__FAKE_FB.accounts[0].password = 'brand-new-9'; const c = JSON.parse(sessionStorage.getItem('__fake_fb')); c.accounts = window.__FAKE_FB.accounts; sessionStorage.setItem('__fake_fb', JSON.stringify(c)); });
    const byName = await page.evaluate(() => window.LetterLadderAuth.login('JeffTest', 'brand-new-9'));
    assertEqual([byName.success, /log in with your email/.test(byName.error)], [false, true], 'username login after reset points to email login');
    const byEmail = await page.evaluate(e => window.LetterLadderAuth.login(e, 'brand-new-9'), EMAIL);
    const pdoc = (await db(page))['players/jeffuid'];
    assertEqual([byEmail.success, byEmail.username, await decrypt(page, pdoc.authEmailEnc, 'brand-new-9'), await decrypt(page, pdoc.authEmailEnc, 'secret123'), logs.some(l => /re-encrypted with the current password/.test(l))], [true, 'JeffTest', EMAIL, null, true], 're-encrypted with the new password');
    await page.evaluate(() => window.LetterLadderAuth.logOut());
    assertEqual((await page.evaluate(() => window.LetterLadderAuth.login('JeffTest', 'brand-new-9'))).success, true, 'username login works again');
    await ctx.close();
  }],
  ['changing the password on the profile page re-encrypts the email with the new password', async ({ browser, base }) => {
    const { ctx, page } = await open(browser, base, { accounts: [realAcct()] });
    await page.goto(base + '/about.html');
    const blob = await encrypt(page, EMAIL, 'secret123');
    await page.evaluate(b => { Object.assign(window.__FAKE_FB.docs, { 'players/jeffuid': { username: 'JeffTest', usernameLower: 'jefftest', leaderboardVisible: true, authEmailEnc: b } }); const c = JSON.parse(sessionStorage.getItem('__fake_fb')); c.docs = window.__FAKE_FB.docs; sessionStorage.setItem('__fake_fb', JSON.stringify(c)); }, blob);
    await gameReady(page, base); await page.evaluate(() => window.LetterLadderAuth.login('JeffTest', 'secret123'));
    await page.goto(base + '/profile.html'); await page.waitForSelector('#update-account-btn', { timeout: 10000 });
    await page.fill('#new-password-field', 'changed-77'); await page.click('#update-account-btn');
    await page.waitForFunction(() => /Updated/.test((document.getElementById('pw-message') || {}).textContent || ''), null, { timeout: 10000 });
    await page.waitForTimeout(600);
    const pdoc = (await db(page))['players/jeffuid'];
    assertEqual([await decrypt(page, pdoc.authEmailEnc, 'changed-77'), noEmailIn(pdoc)], [EMAIL, true], 'new password decrypts');
    await ctx.close();
  }],
  ['synthetic accounts sign in exactly as before (stored synthetic address, or none - built from the username)', async ({ browser, base }) => {
    const accounts = [{ uid: 'synA', email: 'oldie@letterladder.user', password: 'pw-a' }, { uid: 'synB', email: 'nodoc@players.letterladder.io', password: 'pw-b' }];
    const docs = { 'players/synA': { username: 'Oldie', usernameLower: 'oldie', authEmail: 'oldie@letterladder.user' } };
    const { ctx, page } = await open(browser, base, { accounts, docs });
    const home = await homeAuth(page, base, 'login', { username: 'Oldie', password: 'pw-a' });
    assertEqual([home.username, JSON.stringify((await db(page))['players/synA'])], ['Oldie', JSON.stringify(docs['players/synA'])], 'home: signed in, document unchanged');
    await gameReady(page, base); await page.evaluate(() => window.LetterLadderAuth.logOut());
    const r = await page.evaluate(() => window.LetterLadderAuth.login('NoDoc', 'pw-b'));
    assertEqual([r.success, r.username, await signedIn(page)], [true, 'NoDoc', 'synB'], 'game: no document, synthetic address from the username');
    await ctx.close();
  }],
]).then(failed => process.exit(failed ? 1 : 0));
