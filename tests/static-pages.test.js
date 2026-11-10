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

const MODAL_TEXT = [
  'Fill in the missing words by adding exactly one letter to the word below. Rearrange the letters as needed to make a new word.',
  'Words can be guessed in any order',
  'Every word must be a real English word',
  'New puzzles drop daily at 12am EST.',
];
function hasSocialTags(html){
  return ['og:title', 'og:description', 'og:image', 'og:url', 'twitter:card', 'twitter:title', 'twitter:image']
    .filter(t => !html.includes(`"${t}"`)) ;
}
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
    for(const t of ['cart → cater', 'cat → cart', 'three puzzles every day', 'Words can go in any order', 'fill in whichever rung', '3 to 6', '4 to 7', '5 to 8', 'letters long', 'Golden Ladder', 'HELP at the bottom', 'midnight your time', '7-day streak period'])
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
  ['homepage: "Missed a day?" link below the date, no underline, tagline under it, live count', async ({ browser, base }) => {
    for(const [device, now] of [[false, NOW], ['Pixel 7', NOW], [false, new Date('2026-11-04T12:00:00-05:00')]]){
      const { ctx, page } = await newPage(browser, { fake: { user: null }, mobile: device, now });
      await page.goto(base + '/index.html'); await page.waitForTimeout(600);
      const r = await page.evaluate(() => {
        const box = s => document.querySelector(s).getBoundingClientRect();
        const a = document.getElementById('past-puzzles-link'), cs = getComputedStyle(a);
        const attr = document.getElementById('play-date-attribution');
        return { text: a.textContent.trim(), href: a.getAttribute('href'), line: cs.textDecorationLine, border: cs.borderBottomStyle,
          attr: attr.textContent, linkTop: box('#past-puzzles-link').top, dateBottom: box('#play-date').bottom, attrBottom: box('#play-date-attribution').bottom,
          introTop: box('.landing-intro').top, linkBottom: box('#past-puzzles-link').bottom };
      });
      const label = `${device || 'desktop'}${r.attr ? ' with attribution' : ''}`;
      const past = Object.keys(sched.S).filter(k => k < now.toLocaleDateString('en-CA', { timeZone: 'America/New_York' })).reduce((n, k) => n + Object.keys(sched.S[k]).length, 0);
      assertEqual([r.text, r.href, r.line, r.border], [`Missed a day? Play ${past} past puzzles here`, 'past-puzzles.html', 'none', 'none'], `link on ${label}`);
      assertEqual(r.linkTop >= r.dateBottom && r.linkTop >= r.attrBottom - 1, true, `link below the date and attribution, not overlapping (${label})`);
      assertEqual(r.introTop >= r.linkBottom, true, `tagline below the link (${label})`);
      await ctx.close();
    }
  }],
  ['past-puzzles.html: intro has the live count', async ({ browser, base }) => {
    const { ctx, page } = await newPage(browser, { now: NOW });
    await page.goto(base + '/past-puzzles.html'); await page.waitForTimeout(300);
    assertEqual(await page.textContent('.intro'), `Missed a day? Play ${PAST_COUNT} past puzzles here`, 'intro');
    await ctx.close();
  }],
  ['site footer on every page: links centred, Leaderboard, Instagram then Facebook', async ({ browser, base }) => {
    const pages = ['index.html', 'game.html', 'how-to-play.html', 'past-puzzles.html', 'about.html', 'contact.html', 'contact-sent.html', 'privacy.html', 'terms.html', 'solutions.html', 'leaderboard.html', 'past-leaderboards.html', 'stats.html', 'profile.html'];
    const want = ['About', 'Contact', 'Privacy Policy', 'Leaderboard', 'Instagram', 'Facebook'];
    for(const device of [false, 'Pixel 7']){
      const { ctx, page } = await newPage(browser, { fake: { user: null }, localStorage: { 'letterladder:howToPlaySeen': '1', 'letterladder:timerChoiceMade': '1', 'letterladder:timerChoice': 'timed' }, mobile: device, now: NOW });
      for(const f of pages){
        await page.goto(base + '/' + f); await page.waitForTimeout(f === 'game.html' ? 1200 : 400);
        assertEqual(page.url().endsWith(f), true, `${f} stayed on its page`);
        const r = await page.evaluate(() => {
          const nav = document.querySelector('footer .footer-nav');
          if(!nav) return null;
          const links = [...nav.querySelectorAll('a')];
          const nb = nav.getBoundingClientRect(), first = links[0].getBoundingClientRect(), last = links[links.length - 1].getBoundingClientRect();
          const rows = new Set(links.map(a => Math.round(a.getBoundingClientRect().top)));
          return { names: links.map(a => a.textContent.trim()), fb: links.find(a => a.textContent.trim() === 'Facebook').getAttribute('href'),
            off: rows.size === 1 ? Math.abs((first.left - nb.left) - (nb.right - last.right)) : 0, visible: getComputedStyle(nav.closest('footer')).visibility };
        });
        assertEqual(r && [r.names, r.fb, r.visible], [want, 'https://facebook.com/people/Letter-Ladder/61593469157230/', 'visible'], `footer on ${f} (${device || 'desktop'})`);
        assertEqual(r.off <= 2, true, `footer links centred on ${f} (${device || 'desktop'}), off by ${r.off}px`);
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
    await page.goto(base + '/game.html'); await page.waitForFunction(() => accountScopeReady === true); await page.waitForTimeout(300);
    await page.click('#howto-icon-btn'); await page.waitForTimeout(300);
    assertEqual(await page.$eval('.howto-card a[href="how-to-play.html"]', a => a.textContent.trim()), 'Read the full rules', 'game modal link');
    for(const t of MODAL_TEXT) assertEqual((await page.textContent('.howto-card')).includes(t), true, `game modal still says "${t}"`);
    await ctx.close();
  }],
]).then(failed => process.exit(failed ? 1 : 0));
