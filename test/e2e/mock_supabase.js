// Fake supabase-js for browser tests: a signed-in admin with a wallet, plus plausible answers for every RPC the site uses.
(function () {
  const S = JSON.parse(localStorage.getItem("mockdb") || '{"bal":100000}');
  const save = () => localStorage.setItem("mockdb", JSON.stringify(S));
  const user = { id: "u1", email: "m@x", user_metadata: { has_password: true } };
  const delay = (v, ms = 350) => new Promise((r) => setTimeout(() => r(v), ms));
  const profiles = [{ id: "u1", nickname: "בנימין", is_admin: true, character_key: "char_00", username: "בנימין" }, { id: "u2", nickname: "דני", is_admin: false, character_key: null }];
  function table(t) {
    const rows = t === "leaderboard" ? profiles.map((p, i) => ({ ...p, wealth: i ? 24500 : S.bal })) : t === "wallets" ? [{ user_id: "u1", balance: S.bal }] : t === "profiles" ? profiles : [];
    const q = { select: () => q, eq: () => q, order: () => delay({ data: rows, error: null }), single: () => delay({ data: rows[0], error: null }), insert: () => delay({ error: null }) };
    return q;
  }
  const card = () => "AKQJT98765432"[Math.floor(Math.random() * 13)] + "SHDC"[Math.floor(Math.random() * 4)];
  let bj = null;
  const rpc = async (name, a = {}) => {
    await delay(0, 400);
    switch (name) {
      case "rl_history": return { data: [17, 0, 32, 5] };
      case "rl_spin": { const n = Math.floor(Math.random() * 37); const tot = a.p_bets.reduce((s, b) => s + b.amt, 0);
        const lucky = a.p_mode && a.p_mode !== "classic" ? { [n]: 100, 7: 50 } : {}; const pay = a.p_bets.filter((b) => b.nums.includes(n)).reduce((s, b) => s + Math.floor(b.amt * 36 / b.nums.length), 0);
        S.bal += pay - tot; save(); return { data: { id: "x", result: n, total: tot, payout: pay, balance: S.bal, lucky } }; }
      case "sl_spin": { const st = [0, 1, 2].map(() => Math.floor(Math.random() * 32)); S.bal -= a.p_line_bet * 5; save(); return { data: { stops: st, wins: [], mult: 0, total: a.p_line_bet * 5, payout: 0, balance: S.bal } }; }
      case "bj_current": return { data: null };
      case "bj_my_boost": return { data: 4 };
      case "bj_deal": { bj = { id: "r1", status: "playing", active: 0, actions: ["hit", "stand"], balance: (S.bal -= a.p_main), main_bet: a.p_main, staked: a.p_main,
          dealer: [card(), "??"], dealer_total: 10, hands: [{ cards: [card(), card()], bet: a.p_main, total: 15 }] }; save(); return { data: bj }; }
      case "bj_action": { bj = { ...bj, status: "done", actions: [], dealer: [bj.dealer[0], card(), card()], dealer_total: 20, payout: 0,
          result: { net: -bj.main_bet, hands: [{ outcome: "lose" }], side: { earned: 6, tier: "17" }, dealer_blackjack: false } }; return { data: bj }; }
      case "rl_live_state": { const C = 48000, Wn = 25000, t = Date.now(), n = Math.floor(t / C), st = n * C, open = t < st + Wn;
        const res = (n * 7919) % 37; S.live = S.live || {};
        const mine = (S.live[n] || []); const sentTot = mine.reduce((s, b) => s + b.amt, 0);
        let payout = null; if (!open) { payout = mine.filter((b) => b.nums.includes(res)).reduce((s, b) => s + Math.floor(b.amt * 36 / b.nums.length), 0);
          if (!S.paid || S.paid < n) { S.bal += payout; S.paid = n; save(); } }
        return { data: { now: t, round: n, start: st, close: st + Wn, end: st + C, open, result: open ? null : res, lucky: open || a.p_mode === "classic" ? {} : { [res]: 200, 11: 50 },
          mine, payout, balance: S.bal, history: [17, 0, 32, 5, 26],
          players: [{ id: "u2", name: "דני", total: 300, nums: [[17], [1, 2, 3]] }].concat(sentTot ? [{ id: "u1", name: "בנימין", total: sentTot, nums: mine.map((b) => b.nums) }] : []) } }; }
      case "rl_live_bet": { const tot = a.p_bets.reduce((s, b) => s + b.amt, 0); S.live = S.live || {}; (S.live[a.p_round] = S.live[a.p_round] || []).push(...a.p_bets);
        S.bal -= tot; save(); return { data: { ok: true, balance: S.bal } }; }
      case "chat_since": { S.chat = S.chat || [{ id: 1, kind: "user", body: "מי בא לרולטה?", uid: "u2", name: "דני" }, { id: 2, kind: "sys", body: "🎉 דני זכה ב־₪6,300 על 17 ⚡ 200x" }];
        return { data: S.chat.filter((m) => m.id > (a.p_after || 0)) }; }
      case "chat_send": { S.chat.push({ id: S.chat.length + 1, kind: "user", body: a.p_body, uid: "u1", name: "בנימין" }); save(); return { data: S.chat.length }; }
      case "gc_public": return { data: { challenges: false, games: { blackjack: true, lightning_bj: true, roulette: true, lightning: true, xxx: true, slots: true, fortune: true, poker: false, jobs: true } } };
      case "admin_settings": case "admin_set": return { data: { challenges: false, games: { poker: false }, salary_weekly: 5000, salary_monthly: 25000, starting_balance: 10000, season: null } };
      case "admin_members": return { data: [{ id: "u1", name: "בנימין", username: "בנימין", admin: true, balance: S.bal, joined: "2026-10-20" }, { id: "u2", name: "דני", username: "dani", balance: 24500, joined: "2026-10-24", seated: "חבר׳ה" }] };
      case "rl_live_recent": return { data: Array.from({ length: a.p_limit }, () => { const n = Math.floor(Math.random() * 37); return { n, x: a.p_mode !== "classic" && Math.random() < 0.12 ? 200 : null }; }) };
      case "admin_pending_codes": return { data: [] };
      default: return { data: null };
    }
  };
  window.supabase = { createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user } } }), onAuthStateChange() {}, signOut: async () => ({}), signInWithPassword: async () => ({}) },
    from: table, rpc,
    storage: { from: () => ({ createSignedUrls: async (names) => ({ data: names.map(() => ({ signedUrl: null })) }), createSignedUrl: async () => ({ data: null }) }) },
  }) };
})();
