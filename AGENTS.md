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
  Use a fresh Unix timestamp or content hash for new asset versions; never reuse a previously published version URL for different bytes.
  Same-origin JS/CSS in `sw.js` must revalidate online and use cached code only on network failure. Run `node test/cache_policy_test.cjs` when changing this policy.
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

## Full workflow for an agent that also controls the owner's computer
1. `git pull` on `main`. Read this file. Make the change; keep the style of the surrounding code.
2. Run the relevant tests in `test/` if a local Postgres is available; otherwise re-read your SQL carefully.
3. Bump `?v=` for every changed JS/CSS file in every page that loads it, and update `docs/version.json`.
4. Commit with a clear message and push to `main` (or open a PR and merge it, if the owner asked for PRs).
5. **If you added a migration:** open the Supabase dashboard in the owner's browser (he is already signed in) →
   project `golan-casino` (ref `mmoutbadlczgatdgcpvp`) → **SQL Editor** → new query → paste the **whole** new migration file → **Run**.
   If the editor asks to confirm a destructive query, confirm only if the migration is yours and you understand why.
   Then verify with a small query, e.g. `select pg_get_functiondef('function_name'::regproc);` or a `select` on the new table.
   Migrations run in number order; run every new one you created, oldest first. Never edit or re-run an old migration.
6. Wait for the GitHub Pages deploy: `gh run list -L 1` until the run for your commit is `completed` / `success`
   (re-run with `gh run rerun <id>` if it failed for a network reason).
7. Open https://binyaminh4-cloud.github.io/golan-casino/ (or the changed page) and check the change looks right.
8. Tell the owner, in Hebrew, in a few lines: what changed, where to see it, and anything you could not check.

Never type passwords, never change Supabase auth/security settings, never delete data or tables unless the owner asked for exactly that.
