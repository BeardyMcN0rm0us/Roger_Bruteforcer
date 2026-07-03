# ⚔️ Beardy's Battle Chess

Chess where the pieces are little people who **fight for their squares** — a mash-up of
chess.com, Duolingo's chess course, and the classic Amiga *Battle Chess*.

Every capture plays out as an animated duel: the knight swings his mace, the bishop
whacks with his staff, the queen zaps from range, and the loser goes down in a shower
of (toggleable) cartoon blood.

## Features

- **Full chess rules** — castling, en passant, promotion, check/checkmate/stalemate,
  fifty-move and insufficient-material draws. Built from scratch, fully tested.
- **Battle cutscenes** — unique weapons per piece, comic-book impact banners
  (SPLAT! KAPOW!), blood splats that stain the board. Tap to skip. The 🩸 toggle
  switches to family-friendly star-sparks instead.
- **A ladder of AI opponents:**
  | Opponent | Style | ~Rating | Engine |
  |---|---|---|---|
  | Daisy | The Rookie | 500 | built-in JS engine, blunders on purpose |
  | Eadie | The Scrapper | 900 | built-in JS engine |
  | Sidney | The Tactician | 1400 | built-in JS engine, ~1s think |
  | The Duchess | Master | 2000 | **Stockfish 10 (WASM)**, limited skill |
  | King Beardy | Grandmaster | 2850 | **Stockfish 10 (WASM)**, full strength |
  | The Mystery Knight | Adaptive | — | matches your rating automatically |
- **Elo-style rating** — every rated game updates your rating; the adaptive
  opponent uses it to always give you a real fight.
- **The Academy** — Duolingo-style lesson path: learn each piece with bite-size
  capture drills (starred vs par), then checkmate basics, then a boss battle.
- **Puzzles** — mate-in-one challenges, all machine-verified.
- **Two-player** hot-seat mode, hints, undo, synthesized sound effects
  (no audio assets), fully responsive for phones/tablets/desktop.

## Run it

It's a static web app — no build step, no dependencies.

```bash
cd beardys-battle-chess
python3 -m http.server 8000
# open http://localhost:8000
```

Or deploy the folder to any static host (GitHub Pages, Netlify, …).
For GitHub Pages: Settings → Pages → deploy from branch, folder `/beardys-battle-chess`
(or copy the folder to a `gh-pages` branch root).

> Opening `index.html` directly from disk (`file://`) also works, except the two
> Stockfish-backed masters then fall back to the strongest built-in engine
> (browsers block Web Workers on `file://`).

## Tech notes

- `js/engine.js` — move generation & rules (validated with perft + mate suites)
- `js/ai.js` — built-in opponent: minimax, alpha-beta, quiescence, iterative deepening
- `js/opponents.js` — opponent roster, Stockfish worker wrapper, adaptive Elo logic
- `js/characters.js` — all piece art is generated inline SVG (no image assets)
- `js/battle.js` — capture duel cutscenes
- `js/lessons.js` — Academy lessons & puzzle definitions, progress in `localStorage`
- `vendor/stockfish/` — Stockfish 10 WASM build (GPL — see `Copying.txt`)
