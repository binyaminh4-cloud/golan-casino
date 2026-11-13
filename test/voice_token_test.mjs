// Run: node --experimental-strip-types test/voice_token_test.mjs
// Checks the voice-token server function with fake Supabase/Daily answers: tickets only for signed-in members while the cap is open,
// and every failure answers "closed" (fail closed).
import assert from "node:assert/strict";

let handler, env = {}, calls = [], net = {};
globalThis.Deno = { env: { get: (k) => env[k] }, serve: (fn) => { handler = fn; } };
globalThis.fetch = async (url, opt = {}) => {
  calls.push({ url: String(url), opt });
  for (const [k, f] of Object.entries(net)) if (String(url).includes(k)) return f(opt);
  throw new Error("unexpected fetch " + url);
};
await import("../supabase/functions/voice-token/index.ts");

const json = (status, body) => new Response(JSON.stringify(body), { status });
const good = () => {
  env = { SUPABASE_URL: "https://x.supabase.co", SUPABASE_ANON_KEY: "anon", DAILY_API_KEY: "secret" };
  net = {
    "/auth/v1/user": () => json(200, { id: "u1" }),
    "/rpc/voice_status": () => json(200, { open: true }),
    "/rest/v1/profiles": () => json(200, [{ nickname: "דני" }]),
    "api.daily.co": () => json(200, { token: "T123" }),
  };
  calls = [];
};
const run = async (headers = { authorization: "Bearer jwt" }) => {
  const r = await handler(new Request("https://f/voice-token", { method: "POST", headers }));
  return { status: r.status, body: await r.json() };
};

good(); let r = await run();
assert.equal(r.status, 200); assert.equal(r.body.token, "T123");
const d = JSON.parse(calls.find((c) => c.url.includes("daily")).opt.body).properties;
assert.equal(d.room_name, "golan-voice-8k3x"); assert.equal(d.user_name, "דני"); assert.equal(d.eject_at_token_exp, true);
assert.ok(d.exp > Date.now() / 1000 && d.exp <= Date.now() / 1000 + 7201, "ticket expires within 2h");
assert.ok(!JSON.stringify(r.body).includes("secret"), "API key never returned");

good(); r = await run({}); assert.equal(r.status, 401); assert.equal(calls.length, 0, "no login = nothing asked");
good(); net["/auth/v1/user"] = () => json(401, {}); r = await run(); assert.equal(r.status, 401); assert.ok(!calls.some((c) => c.url.includes("daily")));
good(); net["/rpc/voice_status"] = () => json(200, { open: false }); r = await run(); assert.equal(r.status, 403); assert.equal(r.body.reason, "cap_reached"); assert.ok(!calls.some((c) => c.url.includes("daily")));
good(); net["/rpc/voice_status"] = () => json(500, {}); r = await run(); assert.equal(r.status, 503); assert.ok(!calls.some((c) => c.url.includes("daily")));
good(); net["/rest/v1/profiles"] = () => json(200, []); r = await run(); assert.equal(r.status, 403); assert.equal(r.body.reason, "not_a_member");
good(); net["api.daily.co"] = () => json(500, {}); r = await run(); assert.equal(r.status, 503); assert.ok(!r.body.token);
good(); net["api.daily.co"] = () => { throw new Error("down"); }; r = await run(); assert.equal(r.status, 503); assert.ok(!r.body.token);
good(); delete env.DAILY_API_KEY; r = await run(); assert.equal(r.status, 503); assert.equal(r.body.reason, "not_configured");
good(); r = { status: (await handler(new Request("https://f/voice-token", { method: "OPTIONS" }))).status }; assert.equal(r.status, 200);

console.log("VOICE TOKEN TESTS PASSED (10)");
