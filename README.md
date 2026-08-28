# Letter Ladder

A daily word-ladder puzzle game. Each day features three puzzles (Easy, Medium, Hard) — climb from a short starting word to a longer final word, one valid word at a time, each step exactly one letter longer than the last.

Live at [letterladder.io](https://letterladder.io).

## How it works

Given a starting word and a final word, fill in every word "rung" in between, each one letter longer than the last and reachable by rearranging/adding to the previous rung's letters (using the letter bank provided). Solve all three tiers to complete the day.

## Features

- **Three daily puzzles** — Easy, Medium, Hard, each with its own letter bank and word chain
- **Timed and untimed modes** — hints add a time penalty in timed mode
- **Accounts** — username/password sign-up, optional recovery email for password resets, guest play supported
- **Leaderboards** — today's top times per tier, plus a Past Leaderboards archive
- **Stats page** — played/solved/streak tracking per tier, plus a time-summary table (best time, your average, and the global average per tier, sourced from the same leaderboard data)
- **Cross-device sync** — signed-in accounts sync in-progress puzzle state, stats, and timer preference across devices/browsers via Firestore
- **Drag-and-drop letter bank** — reorder tiles with a live positional preview before dropping
- **Past Puzzles archive** — replay any earlier day's puzzles (untimed, doesn't affect stats/leaderboard)
- **Shareable results** — copy a Wordle-style result summary after solving

## File structure

| File | Purpose |
|---|---|
| `index.html` | The game itself — puzzle logic, accounts, timer, letter bank, sharing |
| `about.html` | How to play |
| `leaderboard.html` | Today's leaderboard |
| `past-leaderboards.html` | Leaderboard archive by date |
| `past-puzzles.html` | Archive of playable past puzzles |
| `solutions.html` | View a puzzle's solution |
| `stats.html` | Personal stats and time-summary table |
| `profile.html` | Account settings (password, recovery email, logout) |
| `delete-account.html` | Account deletion flow |
| `contact.html` / `contact-sent.html` | Contact form |
| `migrate.html` | One-time legacy data migration helper |
| `data/puzzles.js` | Daily puzzle schedule (start/final word per tier per date) |
| `data/hints.js` | Hint data per puzzle |
| `data/words.js` | Valid word list used for guess validation |

## Tech stack

Static HTML/CSS/vanilla JS — no build step, no framework. Hosted on GitHub Pages.

**Firebase** (Auth + Firestore) handles accounts and all cross-device data:

- `players` — account records (username, recovery email, created date)
- `playerStats` — aggregate stats (played/solved/streaks) and timer-choice preference
- `scores` — individual timed-completion records, powering the leaderboards
- `dailyProgress` — in-progress puzzle state per account per day, enabling cross-device sync

All Firebase config/keys are embedded client-side (standard for Firebase web apps — access is governed by Firestore security rules, not by keeping the config secret).

## Known limitations / things to revisit

- **Firestore security rules are still in test mode** — should be locked down before a full public launch.
- **Password-reset emails can take 5–15 minutes to arrive.** Firebase's default sender domain is shared across many unrelated projects, which affects deliverability speed. A custom sending domain (via SPF/DKIM) or a dedicated transactional email service would fix this, but both require additional setup (and, for the email-service route, a paid Firebase plan plus a backend function).
- **No backend/Cloud Functions** — everything currently runs client-side against Firestore directly.
- Custom domain for the password-reset sender was evaluated and deferred due to cost.

## Deployment

Static files — push to the `main` branch (or whichever branch GitHub Pages is configured to serve) and it's live. No build step.
