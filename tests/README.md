# Regression tests

Browser tests that load the real site pages with a fake, in-memory Firebase
(see `helpers/harness.js`), so they never touch the real Firebase project.

Requirements: Node 18+ and Playwright with Chromium (`npm i -g playwright`,
then `npx playwright install chromium`).

Run from the repository root:

```
NODE_PATH=$(npm root -g) node tests/timer-default.test.js
```

Each file prints PASS/FAIL per case and exits non-zero if any case fails.

This folder is for the testing repository only; it is not part of
production releases.
