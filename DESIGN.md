# Golan Casino – Design & Plan (v1)

## Requirements added by owner
- No generated graphics without a detailed request; when graphics are missing, write a ChatGPT image prompt instead.
- Prefer free, properly licensed web assets (CC0 first: Kenney.nl, OpenGameArt). Record each asset's license.
- Feel: a real casino, not a "game". Start with classic games; custom games come later on the same wallet.

## Research (verified 2026-10-24 from repo READMEs)
| Candidate | License | Games | Multiplayer | Trusted wallet | Effort | Verdict |
|---|---|---|---|---|---|---|
| Lemelson/casino-by-ai | MIT | Slots, Blackjack, Roulette, Plinko | No | No – wallet in localStorage; logic must move to server | Medium | Possible with modifications (reuse rules/RTP logic, not the pixel UI) |
| ptwu/distributed-texasholdem | MIT | Hold'em | Yes, Socket.IO rooms | Not verified; student project, 6 open issues | Medium-high | Demo-only / reference |
| Ge-limin/poker-engine-ts | MIT | Hold'em NL/PL/FL, 2/6/9 seats | Engine only (no networking) | Event-sourced, side pots, property-tested chip conservation, Supabase adapter | Medium | Recommended (rules engine) |
| johakr/html5-slot-machine | MIT (icons: KPD Media, free use) | Slots UI | No | Callbacks only, not trusted | Low | Possible with modifications (frontend only; replace Star Wars-themed icons) |
| GameDistribution / GamePix / itch.io | Ad-based publisher terms | Varies | Rarely | No trusted results from iframes | — | Rejected for the shared wallet |

## Architecture
- React + TypeScript frontend; Supabase (Auth with invite-only, Postgres, Realtime for leaderboard).
- One small Node game server (Socket.IO) that hosts poker-engine-ts tables and runs solo-game RNG/settlement; calls Postgres functions with the service key (never in browser).
- Wallet: `wallets` (balance ≥ 0 check), `wallet_transactions` (unique settlement_ref), all changes via SECURITY DEFINER SQL functions in one transaction with row lock (`SELECT … FOR UPDATE`).
- Poker buy-in moves funds wallet → table stack (ledger entry); leave/timeout returns stack. Abandoned seat: auto-fold, stack returned after 10 min.
- Empty balance: unaffordable bets disabled with explanation. Future option: admin reset / seasons.

## Visual system (lobby)
- Colors: room #120d0a, wood #2a1c14 / #3a281c, felt #0f5a3f / #0a4430, gold #d9b56f, text #f5efe4 / #c9bba6, error #e56b6f.
- Fonts: Frank Ruhl Libre 500/700 (display), Heebo 400/500/700 (body), Inter (numbers, LTR-isolated).
- Spacing 4/8/12/16/24/32; radius 6px (tables 10px, felt oval 120px); content max 1200px; rail 320px, stacks under 900px.
- Games are felt tables with wood rims; chips are real casino denominations colors. Only CSS textures – no generated art.

## Graphics wishlist (ChatGPT prompts, only when owner asks)
1. Logo: "Gold embossed logo text 'Golan Casino' in Hebrew 'גולן קזינו', art-deco casino style, dark walnut background, transparent PNG, 1024x1024"
2. Lobby background: "Photorealistic dim luxury casino interior, walnut wood panels, green felt tables out of focus, warm brass lamps, no people, no text, 1920x1080"
