# Golan Casino — notes for coding agents (Codex, Claude)

A private, satirical casino for a group of friends. **Play money only.** UI language: Hebrew (RTL). Owner: Binyamin.

## How it runs
- **Front end:** static files in `docs/`, served by **GitHub Pages** from this repo (push to `main` = deploy, ~1–2 min).
  No build step: plain HTML + JS + CSS. Supabase JS client from CDN; settings in `docs/config.js`.
- **Back end:** **Supabase** (Postgres). All game logic and money live in SQL functions (`security definer`), called with `db.rpc(...)`.
  The browser only draws; the server decides every result and every payout.
- **Migrations:** `supabase/migrations/NNNN_name.sql`, numbered in order (next free number = last + 1).
  They are **not applied automatically**: after merging, the owner runs the new file's SQL in the Supabase dashboard → SQL editor.
  Always write migrations so they can be re-run safely (`create or replace`, `if not exists`, `drop ... if exists`).
  To change a function, copy its **latest** definition (search all migrations, take the highest number) and edit that.

## Rules that matter
- **Cache busting:** every changed JS/CSS file is loaded as `file.js?v=N` in the HTML pages. When you change a file, bump its `?v=` in
  **every** page that loads it, and write a new timestamp to `docs/version.json` (`{"v": <unix time>}`) — open apps reload themselves when it changes.
- **Money** only moves through `apply_tx(user, game, kind, amount, ref)` (wallet) and `bank_add(user, kind, amount, ref)` (bank).
  Every movement has a unique `ref` (idempotent). Never update balances directly.
- **Orientation:** games are landscape-only (`landscape.js`); lobby, jobs, bank and challenges are portrait-only on phones (`portrait.js`).
  On iPad everything is landscape.
- **Sound:** shared helpers in `docs/sfx.js` (`SFX.*`, `SFX.fx("file")` for files in `docs/snd/`). Music ≈ 20%, effects ≈ 80%.
- **Chat announcements:** wins only at ×200 the bet or more; bonus buys at ×3 the price or more.
- **Test users** (nickname starting with `test` / `בדיקה`, see `gc_is_test`) never get prizes, rankings or bot names.
- **Ido** (`docs/guide.js`, `GC_STEPS`) explains every game; update his texts when a game's rules change.
- Humorous texts shown to players need the owner's approval.
- Never handle or reveal passwords; never bypass auth.

## Tests
SQL tests in `test/*.sql` (run against a local Postgres with `test/supabase_stub.sql` + all migrations).
`seasons_tests.sql` needs `blackjack_tests.sql` first. Pages have a `?preview` mode that works without a login, for screenshots.

## Map
- Lobby: `docs/index.html`, `app.js`, `lobby-ui.js`, `lobby.css` · Games: `roulette.html`/`rl.js`, `blackjack.html`/`bj2d.js`, `poker.html`/`pk.js`,
  `dp.html`/`dp.js` (poker vs dealer), slots (`slots.html`, `dragons`, `wildwest`, `kinneret`, `pachinko`), `chicken`, `fishing`, `protein`, `fisher90`
- Jobs: `jobs.html`/`jobs.js`, `bus`, `fishjob`, `fiber` · Bank & loans: `bank.html` · Challenges: `challenges.html`/`ch.js` · Admin: `admin.html`
