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
