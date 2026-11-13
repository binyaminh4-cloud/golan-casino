# Browser tests (Issue #10)

One command, from the repo root:

```
node test/e2e/run.cjs
```

Needs Node, Playwright and Chrome. Playwright is found as `playwright` or via `GC_PLAYWRIGHT=/path/to/playwright`.
No network: the supabase CDN, fonts and everything outside `docs/` are blocked/faked, so the run is the same anywhere.
It serves `docs/` on a free local port, opens **one page at a time**, and uses software WebGL for the 3D pages (slow: a full run takes a few minutes).

Options: `--repeat 3` (every test 3 times, use this to check stability) · `--only TEXT` · `--shots DIR` (screenshots, default `/tmp/gc-e2e`).
Exit code is 0 only if everything passed.

## What is checked
- **smoke** - every page with a `?preview` mode (found automatically) loads with no JS error, console error, or missing file. Pages without `?preview` are only listed at the end of the run.
- **roulette3d-live** - a chip on the table is sent to the server by itself, and there is no send button.
- **blackjack3d** - a bet turns into a deal (action buttons, or a finished hand), and "stand" ends the hand.
- **aterf: bonus tables only in close-up** - the bonus tables (`.pot`) show in the wheel close-up and never outside it.
- **aterf: new round starts empty** - after a full round with a bet and a bonus, the next round has no chips, no total, no bonus pockets, no bonus screen.

## Rules for adding tests
- Check what the player sees on the page (a button, a table, a total). Never a short animation.
- 3D pages draw slowly without a GPU: use `waitForFunction`, never a fixed sleep. Use a real mouse click (`page.mouse`), not `page.click`, on pages that animate.
- Every bug Binyamin finds = a new test that catches it.
- A test that fails sometimes goes into `quarantine.json` with the reason (it is then listed in each run, not run).
- Known real bugs (a file the page asks for that is missing) are listed in `KNOWN_MISSING` in `lib.cjs` so everything else stays green. Open an Issue for each, and remove the line when it is fixed.

`errlog_e2e.js` (Issue #9), `qa.js` and `mock_supabase.js` are older, separate helpers (`errlog_e2e.js` needs its own `python3 -m http.server`; `qa.js` = layout check on every device); `mock_supabase.js` is also used by the live roulette test. The old ones are not part of `run.cjs`.
