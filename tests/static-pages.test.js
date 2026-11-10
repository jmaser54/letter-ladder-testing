// Static, crawlable content: How to Play page (and the lines removed from it),
// sitemap entry, homepage text, Open Graph / Twitter tags, the "Read the full
// rules" links in both How to Play modals, the "Missed a day?" link with a
// live count (homepage and Past Puzzles), the site footer on every page, and
// the short /s/ share link.
const { newPage, run, assertEqual } = require('./helpers/harness');
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = path.join(__dirname, '..');
const raw = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const NOW = new Date('2026-11-10T12:00:00-05:00');
const sched = {}; vm.runInNewContext(raw('data/puzzles.js') + ';this.S=PUZZLE_SCHEDULE;', sched);
const PAST_COUNT = Object.keys(sched.S).filter(k => k < '2026-11-10').reduce((n, k) => n + Object.keys(sched.S[k]).length, 0);

// The How to Play rules, verbatim (the "Words can be guessed in any order"
// bullet was removed everywhere in v3).
const MODAL_TEXT = [
  'Fill in the missing words by adding exactly one letter to the word below. Rearrange the letters as needed to make a new word.',
  'For example, not could become tone, note, or torn',
  'A letter can repeat — lead could become ladle by adding a second "L"',
  'Every word must be a real English word',
  'New puzzles drop daily at 12am EST.',
];
const REMOVED_TEXT = ['Words can be guessed in any order', 'any order'];
function hasSocialTags(html){
  return ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card', 'twitter:title', 'twitter:image']
    .filter(t => !html.includes(`"${t}"`)) ;
}
const innerHeightOk = (h, bottom) => h - bottom >= 56;
const headOf = html => html.slice(0, html.indexOf('</head>'));

module.exports = run('Static pages', [
  ['how-to-play.html: modal rules text, details and FAQ are in the static HTML', async () => {
    const html = raw('how-to-play.html').replace(/<[^>]+>/g, '');
    for(const t of [...MODAL_TEXT, 'How to Play', 'How do you play Letter Ladder?', 'How is it different from a classic word ladder?', 'How do hints and timing work?', 'up to two hints', 'adds 3 minutes'])
      assertEqual(html.includes(t), true, `contains "${t}"`);
  }],
  ['how-to-play.html: the example ladders are valid by the game\'s rules', async () => {
    const W = new Set(raw('data/words.js').match(/new Set\("([\s\S]*?)"\.split\("/)[1].split('\\n'));
    const count = w => [...w].reduce((m, c) => (m[c] = (m[c] || 0) + 1, m), {});
    const step = (a, b) => b.length === a.length + 1 && W.has(b) && Object.entries(count(a)).every(([c, n]) => (count(b)[c] || 0) >= n);
    for(const ladder of [['air', 'hair', 'chair', 'chairs', 'cashier', 'archives']])
      for(let i = 1; i < ladder.length; i++) assertEqual(step(ladder[i - 1], ladder[i]), true, `${ladder[i - 1]} → ${ladder[i]}`);
  }],
  ['how-to-play.html: removed lines and difficulty ranges are gone', async () => {
    const html = raw('how-to-play.html').replace(/<[^>]+>/g, '');
    for(const t of [...REMOVED_TEXT, 'cart → cater', 'cat → cart', 'three puzzles every day', 'Words can go in any order', 'fill in whichever rung', '3 to 6', '4 to 7', '5 to 8', 'letters long', 'Golden Ladder', 'HELP at the bottom', 'midnight your time', '7-day streak period'])
      assertEqual(html.includes(t), false, `does not contain "${t}"`);
    assertEqual(raw('how-to-play.html').includes('href="game.html?play=today"'), true, '"Play today\'s puzzle" opens today\'s game');
  }],
  ['sitemap.xml lists how-to-play.html; robots.txt untouched', async () => {
    assertEqual(raw('sitemap.xml').includes('<loc>https://letterladder.io/how-to-play.html</loc>'), true, 'sitemap entry');
    assertEqual(raw('robots.txt').includes('Sitemap: https://letterladder.io/sitemap.xml'), true, 'robots.txt still points to the sitemap');
  }],
  ['homepage static HTML has the heading, intro and "Missed a day?" link', async () => {
    const html = raw('index.html');
    assertEqual(html.includes('<h1 class="brand">Letter Ladder</h1>'), true, 'heading');
    assertEqual(html.includes('Add one letter, scramble to a new word, climb to the top.'), true, 'intro');
    assertEqual(html.includes('<a href="past-puzzles.html" class="past-puzzles-link" id="past-puzzles-link">Missed a day? Play <span id="past-puzzles-count"></span>past puzzles here</a>'), true, 'past puzzles link');
  }],
  ['Open Graph / Twitter tags are in the head of the homepage, How to Play, About and game pages', async () => {
    for(const f of ['index.html', 'how-to-play.html', 'about.html', 'game.html']){
      assertEqual(hasSocialTags(headOf(raw(f))), [], `missing tags in ${f}`);
      assertEqual(headOf(raw(f)).includes('https://letterladder.io/og-image.png'), true, `${f} uses og-image.png`);
    }
  }],
  ['about.html text is static HTML', async () => {
    assertEqual(raw('about.html').includes('<p>All puzzles are crafted by humans.</p>'), true, 'about text');
  }],
  ['how-to-play.html loads in a browser with no errors (desktop and Android)', async ({ browser, base }) => {
    for(const device of [false, 'Pixel 7']){
      const { ctx, page } = await newPage(browser, { mobile: device });
      const errors = []; page.on('pageerror', e => errors.push(e.message));
      const res = await page.goto(base + '/how-to-play.html');
      assertEqual([res.status(), await page.textContent('h1'), errors], [200, 'How to Play', []], `load on ${device || 'desktop'}`);
      await ctx.close();
    }
  }],
  ['homepage: logo → tagline → Play → date → note → "Missed a day?" (no underline, live count)', async ({ browser, base }) => {
    for(const [device, now] of [[false, NOW], ['Pixel 7', NOW], ['iPhone SE', NOW], [false, new Date('2026-11-04T12:00:00-05:00')], ['Pixel 7', new Date('2026-10-01T12:00:00-04:00')]]){
      const { ctx, page } = await newPage(browser, { fake: { user: null }, mobile: device, now });
      await page.goto(base + '/index.html'); await page.waitForTimeout(600);
      const r = await page.evaluate(() => {
        const box = s => document.querySelector(s).getBoundingClientRect();
        const a = document.getElementById('past-puzzles-link'), cs = getComputedStyle(a);
        return { text: a.textContent.trim(), href: a.getAttribute('href'), line: cs.textDecorationLine, border: cs.borderBottomStyle,
          attr: document.getElementById('play-date-attribution').textContent, intro: document.querySelector('.landing-intro').textContent,
          order: ['.brand-logo', '.landing-intro', '#play-buttons', '#play-date', '#play-date-attribution', '#past-puzzles-link'].map(s => [Math.round(box(s).top), Math.round(box(s).bottom)]) };
      });
      const label = `${device || 'desktop'}${r.attr ? ' with attribution' : ''}`;
      const past = Object.keys(sched.S).filter(k => k < now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })).reduce((n, k) => n + Object.keys(sched.S[k]).length, 0);
      assertEqual([r.text, r.href, r.line, r.border, r.intro], [`Missed a day? Play ${past} past puzzles here`, 'past-puzzles.html', 'none', 'none', 'Add one letter, scramble to a new word, climb to the top.'], `text on ${label}`);
      for(let i = 1; i < r.order.length; i++){
        if(i === 4 && !r.attr) continue; // empty attribution has no height
        assertEqual(r.order[i][0] >= r.order[i - 1][1] - 1, true, `${['logo', 'tagline', 'Play', 'date', 'note', 'missed-a-day'][i]} sits below the previous item without overlapping (${label}): ${JSON.stringify(r.order)}`);
      }
      await ctx.close();
    }
  }],
  ['homepage: tagline is bold; signed-in streak line sits between Play and the date', async ({ browser, base }) => {
    for(const device of [false, 'iPhone 13']){
      const { ctx, page } = await newPage(browser, { fake: { user: { uid: 'u1', isAnonymous: false } , docs: { 'players/u1': { username: 'Jeff' } } }, localStorage: { 'letterladder:accountUsername': 'Jeff', 'letterladder:howToPlaySeen': '1' }, mobile: device, now: NOW });
      await page.goto(base + '/index.html'); await page.waitForTimeout(800);
      await page.evaluate(() => { document.getElementById('play-streak').textContent = '🔥 5 day streak'; });
      const r = await page.evaluate(() => { const b = s => document.querySelector(s).getBoundingClientRect();
        return { weight: getComputedStyle(document.querySelector('.landing-intro')).fontWeight, play: [b('#play-buttons').top, b('#play-buttons').bottom], streak: [b('#play-streak').top, b('#play-streak').bottom], date: b('#play-date').top }; });
      assertEqual(r.weight, '700', 'tagline bold');
      assertEqual([r.streak[0] >= r.play[1] + 10, r.date >= r.streak[1]], [true, true], `streak below Play, above the date (${device || 'desktop'}): ${JSON.stringify(r)}`);
      await ctx.close();
    }
  }],
  ['colours: Past Puzzles Play buttons are amber, and no green is used outside the game\'s confetti', async ({ browser, base }) => {
    const { ctx, page } = await newPage(browser, { now: NOW });
    await page.goto(base + '/past-puzzles.html'); await page.waitForTimeout(300);
    assertEqual(await page.$eval('.play-btn', a => [getComputedStyle(a).backgroundColor, getComputedStyle(a).color]), ['rgb(232, 163, 61)', 'rgb(27, 42, 65)'], 'Play button amber with navy text');
    await ctx.close();
    for(const f of fs.readdirSync(ROOT).filter(f => f.endsWith('.html') && f !== 'migrate.html')){
      const html = raw(f).replace(/const colors = \[[^\]]*\]/, ''); // confetti colours are intentional
      assertEqual(/#6fbf8b|var\(--green\)|:\s*green\b|#5b9bd5|#f5c842|#ff5a45|#e27272/i.test(html), false, `${f} has no stray green/blue/yellow/off-red`);
    }
  }],
  ['homepage: "?" button sits left, next to the account icon, exactly where the game page has it; title centred', async ({ browser, base }) => {
    for(const device of [false, 'iPhone 13', 'Pixel 7']){
      const { ctx, page } = await newPage(browser, { fake: { user: null }, localStorage: { 'letterladder:howToPlaySeen': '1', 'letterladder:timerChoiceMade': '1', 'letterladder:lastViewedDateKey': '2026-11-10' }, mobile: device, now: NOW });
      const pos = {};
      for(const f of ['index.html', 'game.html']){
        await page.goto(base + '/' + f); await page.waitForTimeout(f === 'game.html' ? 1200 : 600);
        pos[f] = await page.evaluate(() => { const b = s => document.querySelector(s).getBoundingClientRect(); const q = b('.howto-icon-btn'), a = b('.account-icon-btn'), h = b('h1'), hd = b('header');
          return { left: Math.round(q.left), right: Math.round(q.right), clear: q.left >= a.right, titleOff: Math.round((h.left + h.right) / 2 - (hd.left + hd.right) / 2) }; });
      }
      const where = device || 'desktop';
      assertEqual([pos['index.html'].left, pos['index.html'].right], [pos['game.html'].left, pos['game.html'].right], `same horizontal spot as the game page (${where})`);
      assertEqual([pos['index.html'].clear, Math.abs(pos['index.html'].titleOff) <= 1], [true, true], `no overlap with the account icon, title centred (${where})`);
      await ctx.close();
    }
  }],
  ['homepage on a phone: About / Contact / Privacy stay clear of the browser\'s bottom bar when the page fits', async ({ browser, base }) => {
    for(const h of [750, 844, 932]){
      const { ctx, page } = await newPage(browser, { fake: { user: null }, localStorage: { 'letterladder:howToPlaySeen': '1' }, mobile: 'iPhone 13', now: NOW });
      await page.setViewportSize({ width: 390, height: h });
      await page.goto(base + '/index.html'); await page.waitForTimeout(600);
      const r = await page.evaluate(() => ({ bottom: document.querySelector('footer .footer-secondary').getBoundingClientRect().bottom, attr: !!document.getElementById('play-date-attribution') }));
      assertEqual([innerHeightOk(h, r.bottom), r.attr], [true, true], `footer row ends ${Math.round(h - r.bottom)}px above the bottom of a 390x${h} window (needs ≥ 56px); date note still on the page`);
      await ctx.close();
    }
  }],
  ['past-puzzles.html: intro has the live count', async ({ browser, base }) => {
    const { ctx, page } = await newPage(browser, { now: NOW });
    await page.goto(base + '/past-puzzles.html'); await page.waitForTimeout(300);
    assertEqual(await page.textContent('.intro'), `Missed a day? Play ${PAST_COUNT} past puzzles here`, 'intro');
    await ctx.close();
  }],
  ['site footer on every page: two rows, each on one line - Leaderboard + Instagram/Facebook icons, then About · Contact · Privacy Policy', async ({ browser, base }) => {
    const pages = ['index.html', 'game.html', 'how-to-play.html', 'past-puzzles.html', 'about.html', 'contact.html', 'contact-sent.html', 'privacy.html', 'terms.html', 'solutions.html', 'leaderboard.html', 'past-leaderboards.html', 'stats.html', 'profile.html'];
    for(const device of [false, 'Pixel 7', 'iPhone SE']){
      const { ctx, page } = await newPage(browser, { fake: { user: null }, localStorage: { 'letterladder:howToPlaySeen': '1', 'letterladder:timerChoiceMade': '1', 'letterladder:timerChoice': 'timed' }, mobile: device, now: NOW });
      for(const f of pages){
        await page.goto(base + '/' + f); await page.waitForTimeout(f === 'game.html' ? 1200 : 400);
        assertEqual(page.url().endsWith(f), true, `${f} stayed on its page`);
        const r = await page.evaluate(() => {
          const rows = [...document.querySelectorAll('footer .footer-row')];
          if(rows.length !== 2) return { rows: rows.length };
          const info = row => {
            const links = [...row.querySelectorAll('a')], rb = row.getBoundingClientRect();
            const first = links[0].getBoundingClientRect(), last = links[links.length - 1].getBoundingClientRect();
            return { names: links.map(a => a.getAttribute('aria-label') || a.textContent.trim()), hrefs: links.map(a => a.getAttribute('href')),
              icons: links.map(a => !!a.querySelector('svg') && a.textContent.trim() === ''), oneLine: new Set(links.map(a => Math.round(a.getBoundingClientRect().top + a.getBoundingClientRect().height / 2))).size === 1,
              fits: row.scrollWidth <= row.clientWidth + 1, off: Math.abs((first.left - rb.left) - (rb.right - last.right)),
              color: getComputedStyle(links[0]).color, size: parseFloat(getComputedStyle(links[0]).fontSize) };
          };
          const footer = rows[0].closest('footer'), fb = footer.getBoundingClientRect();
          const plain = [...footer.querySelectorAll('a')].every(a => getComputedStyle(a).backgroundColor === 'rgba(0, 0, 0, 0)');
          // Nothing else on the page sits beside or below the footer.
          const others = [...document.body.querySelectorAll('body > *:not(footer):not(script):not(style):not(noscript)')].filter(e => e.offsetParent !== null && getComputedStyle(e).position !== 'fixed' && !e.contains(footer));
          const below = others.every(e => e.getBoundingClientRect().bottom <= fb.top + 1);
          return { rows: 2, top: info(rows[0]), bottom: info(rows[1]), below: rows[1].getBoundingClientRect().top >= rows[0].getBoundingClientRect().bottom - 1, visible: getComputedStyle(footer).visibility, plain, footerLast: below };
        });
        const where = `${f} (${device || 'desktop'})`;
        assertEqual(r.rows, 2, `two footer rows on ${where}`);
        assertEqual([r.top.names, r.top.hrefs, r.top.icons], [['Leaderboard', 'Instagram', 'Facebook'], ['leaderboard.html', 'https://www.instagram.com/letterladder', 'https://facebook.com/people/Letter-Ladder/61593469157230/'], [false, true, true]], `top row on ${where}`);
        assertEqual([r.bottom.names, r.bottom.icons], [['About', 'Contact', 'Privacy Policy'], [false, false, false]], `bottom row on ${where}`);
        assertEqual([r.top.oneLine, r.top.fits, r.bottom.oneLine, r.bottom.fits, r.below, r.visible], [true, true, true, true, true, 'visible'], `each row on one line, top above bottom on ${where}`);
        assertEqual([r.top.color, r.bottom.color, r.bottom.size < r.top.size], ['rgb(245, 239, 224)', 'rgb(159, 179, 200)', true], `top row cream, bottom row smaller and dim on ${where}`);
        assertEqual(r.top.off <= 2 && r.bottom.off <= 2, true, `rows centred on ${where} (${r.top.off}px, ${r.bottom.off}px)`);
        assertEqual([r.plain, r.footerLast], [true, true], `footer links are plain text links and the footer is below the page content on ${where}`);
      }
      await ctx.close();
    }
  }],
  ['s/ short share link forwards to the homepage with share tracking', async ({ browser, base }) => {
    const html = raw('s/index.html');
    assertEqual([html.includes('noindex'), html.includes('"og:image"')], [true, true], 'noindex + preview tags');
    const { ctx, page } = await newPage(browser, { fake: { user: null }, now: NOW });
    await page.goto(base + '/s/index.html'); await page.waitForURL(/utm_source=share/, { timeout: 5000 });
    assertEqual(page.url(), base + '/?utm_source=share&utm_medium=social&utm_campaign=share_results', 'redirect target');
    await ctx.close();
  }],
  ['both How to Play modals link to how-to-play.html', async ({ browser, base }) => {
    const { ctx, page } = await newPage(browser, { fake: { user: null }, localStorage: { 'letterladder:howToPlaySeen': '1' }, now: NOW });
    await page.goto(base + '/index.html'); await page.waitForTimeout(400);
    await page.click('#howto-btn'); await page.waitForTimeout(300);
    assertEqual(await page.$eval('.howto-card a[href="how-to-play.html"]', a => a.textContent.trim()), 'Read the full rules', 'homepage modal link');
    const homeModal = (await page.textContent('.howto-card')).replace(/\s+/g, ' ');
    for(const t of MODAL_TEXT) assertEqual(homeModal.includes(t), true, `homepage modal says "${t}"`);
    for(const t of REMOVED_TEXT) assertEqual(homeModal.includes(t), false, `homepage modal no longer says "${t}"`);
    await page.goto(base + '/game.html'); await page.waitForFunction(() => accountScopeReady === true); await page.waitForTimeout(300);
    await page.click('#howto-icon-btn'); await page.waitForTimeout(300);
    assertEqual(await page.$eval('.howto-card a[href="how-to-play.html"]', a => a.textContent.trim()), 'Read the full rules', 'game modal link');
    const gameModal = (await page.textContent('.howto-card')).replace(/\s+/g, ' ');
    for(const t of MODAL_TEXT) assertEqual(gameModal.includes(t), true, `game modal says "${t}"`);
    for(const t of REMOVED_TEXT) assertEqual(gameModal.includes(t), false, `game modal no longer says "${t}"`);
    await ctx.close();
  }],
]).then(failed => process.exit(failed ? 1 : 0));
