# Letter Ladder
A daily word puzzle game with three puzzles a day (Easy / Medium / Hard).
Everything runs within the visitor's browser.

## Folder guide
```
index.html          the game itself
about.html           how-to-play / about page
data/words.js        the dictionary used to validate guesses
data/puzzles.js       the daily puzzle schedule
scripts/generate_schedule.py   run this locally after adding new puzzles
scripts/puzzle_bank.xlsx        puzzle spreadsheet
```

## Past solutions page
`solutions.html` ("Yesterday's Solution") shows one worked solution for
yesterday's puzzles only. 

## In-game hints
Each puzzle includes a "Hint" button that reveals the letters (not the exact
word or order) needed for the longest rung you haven't filled in yet. This
is powered by `data/hints.js.'

## Stats, streaks & score
`stats.html` shows played/solved%/streaks/score, per level and combined.
Everything is tracked entirely in the visitor's own browser (localStorage) -
there are no accounts and nothing is sent to a server, which means stats are
per-device (won't follow someone from their phone to their laptop). Score is based on the length of the words a player actually guessed, minus a small penalty for each hint used.

## Difficulty scoring tool
`scripts/difficulty_score.py` is a helper for curating puzzle difficulty
objectively rather than by pure gut feel. It reports TRAPS (real words that look like a valid first move but are dead ends) and BOTTLENECKS (how many real words exist at each step). This helper tool cannot judge how *obvious* a trap word is to an average player, though - that part still requires judgment.
