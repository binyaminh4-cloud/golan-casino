// Golan Casino · voice-token: gives a signed-in member a short-lived ticket to the private Daily voice room.
// No ticket = no voice. Every failure answers "closed" (never lets someone in without a ticket, never bills past our cap).
//
// Needs one secret in Supabase → Edge Functions → Secrets:  DAILY_API_KEY  (Binyamin pastes it himself; never in code).
// SUPABASE_URL and SUPABASE_ANON_KEY are provided by Supabase automatically.
// Deploy: supabase functions deploy voice-token   (or paste this file in the dashboard's Edge Functions editor, name "voice-token").
// UNDO: delete the function in the dashboard and set the Daily room back to public.

const ROOM = "golan-voice-8k3x";          // the room name in https://golancasino.daily.co/<ROOM>
const TICKET_SECONDS = 2 * 60 * 60;       // a ticket lasts 2 hours; Daily disconnects at the end (the app asks for a new one on rejoin)
const ALLOWED_ORIGIN = "https://binyaminh4-cloud.github.io";

const cors = (_origin: string | null) => ({
  "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
});

const withTimeout = (ms: number) => { const c = new AbortController(); setTimeout(() => c.abort(), ms); return c.signal; };

Deno.serve(async (req) => {
  const h = cors(req.headers.get("origin"));
  const answer = (status: number, body: Record<string, unknown>) =>
    new Response(JSON.stringify(body), { status, headers: { ...h, "Content-Type": "application/json" } });
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return answer(405, { ok: false, reason: "method" });

  try {
    const url = Deno.env.get("SUPABASE_URL"), anon = Deno.env.get("SUPABASE_ANON_KEY"), daily = Deno.env.get("DAILY_API_KEY");
    if (!url || !anon || !daily) return answer(503, { ok: false, reason: "not_configured" });
    const auth = req.headers.get("authorization") || "";
    if (!/^Bearer .+/.test(auth)) return answer(401, { ok: false, reason: "not_signed_in" });
    const asUser = { apikey: anon, Authorization: auth, "Content-Type": "application/json" };

    // 1) who is this? (Supabase checks the login token)
    const u = await fetch(`${url}/auth/v1/user`, { headers: asUser, signal: withTimeout(5000) });
    if (!u.ok) return answer(401, { ok: false, reason: "not_signed_in" });
    const user = await u.json();
    if (!user?.id) return answer(401, { ok: false, reason: "not_signed_in" });

    // 2) a member, and the monthly cap is still open? (same server check the app already uses)
    const s = await fetch(`${url}/rest/v1/rpc/voice_status`, { method: "POST", headers: asUser, body: "{}", signal: withTimeout(5000) });
    if (!s.ok) return answer(503, { ok: false, reason: "closed" });
    const st = await s.json();
    if (!st?.open) return answer(403, { ok: false, reason: "cap_reached" });
    const p = await fetch(`${url}/rest/v1/profiles?select=nickname&id=eq.${encodeURIComponent(user.id)}`, { headers: asUser, signal: withTimeout(5000) });
    const prof = p.ok ? (await p.json())?.[0] : null;
    if (!prof) return answer(403, { ok: false, reason: "not_a_member" });

    // 3) ask Daily for a ticket to this room only
    const name = String(prof.nickname || "חבר").slice(0, 40);
    const d = await fetch("https://api.daily.co/v1/meeting-tokens", {
      method: "POST",
      headers: { Authorization: `Bearer ${daily}`, "Content-Type": "application/json" },
      body: JSON.stringify({ properties: {
        room_name: ROOM, user_name: name, user_id: user.id, is_owner: false,
        exp: Math.floor(Date.now() / 1000) + TICKET_SECONDS, eject_at_token_exp: true,
        start_video_off: true, enable_screenshare: false,
      } }),
      signal: withTimeout(8000),
    });
    if (!d.ok) return answer(503, { ok: false, reason: "closed" });
    const t = await d.json();
    if (!t?.token) return answer(503, { ok: false, reason: "closed" });
    return answer(200, { ok: true, token: t.token });
  } catch (_e) {
    return answer(503, { ok: false, reason: "closed" });   // fail closed
  }
});
