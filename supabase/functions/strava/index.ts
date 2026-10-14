// Strava-yhteys Norseman-treenipäiväkirjalle (Supabase Edge Function "strava").
// Toiminnot (?action=): start, callback, sync, disconnect.
// JWT-tarkistus on pois päältä, koska Strava kutsuu callbackia ilman kirjautumista;
// muut toiminnot tarkistavat käyttäjän itse Authorization-otsakkeesta.
// Salaisuudet: STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET (SUPABASE_URL ja SUPABASE_SERVICE_ROLE_KEY tulevat automaattisesti).
import { createClient } from "npm:@supabase/supabase-js@2";

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const db = createClient(SB_URL, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
const CID = Deno.env.get("STRAVA_CLIENT_ID") ?? "";
const CSECRET = Deno.env.get("STRAVA_CLIENT_SECRET") ?? "";
const APP = "https://jehkis.github.io/norseman/";
const REDIRECT = `${SB_URL}/functions/v1/strava?action=callback`;
const START = Date.parse("2026-10-05T00:00:00Z") / 1000; // suunnitelman alku: tätä vanhempia ei tuoda

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...cors, "Content-Type": "application/json" } });

// Stravan lajit → päiväkirjan lajit
const SPORT: Record<string, string> = {
  Run: "run", TrailRun: "run", VirtualRun: "run",
  Ride: "bike", VirtualRide: "bike", GravelRide: "bike", MountainBikeRide: "bike", EBikeRide: "bike", EMountainBikeRide: "bike",
  Swim: "swim",
  WeightTraining: "str",
  Crossfit: "func", HighIntensityIntervalTraining: "func",
  Rowing: "erg", VirtualRow: "erg",
};

async function userOf(req: Request) {
  const t = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!t) return null;
  const { data } = await db.auth.getUser(t);
  return data.user ?? null;
}

async function stravaToken(body: Record<string, string>) {
  const r = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: CID, client_secret: CSECRET, ...body }),
  });
  if (!r.ok) throw new Error(`Strava token ${r.status}`);
  return await r.json();
}

// deno-lint-ignore no-explicit-any
async function accessToken(row: any) {
  if (row.expires_at > Date.now() / 1000 + 60) return row.access_token as string;
  const t = await stravaToken({ grant_type: "refresh_token", refresh_token: row.refresh_token });
  await db.from("strava_tokens").update({
    access_token: t.access_token, refresh_token: t.refresh_token, expires_at: t.expires_at, updated_at: new Date().toISOString(),
  }).eq("user_id", row.user_id);
  return t.access_token as string;
}

async function callback(u: URL) {
  const back = (q: string) => Response.redirect(`${APP}?strava=${q}`, 302);
  const state = u.searchParams.get("state"), code = u.searchParams.get("code");
  if (u.searchParams.get("error") || !state || !code) return back("peruttu");
  if (!(u.searchParams.get("scope") ?? "").includes("activity:read")) return back("oikeudet");
  const { data: row } = await db.from("strava_tokens").select("user_id").eq("state", state).maybeSingle();
  if (!row) return back("virhe");
  const t = await stravaToken({ grant_type: "authorization_code", code });
  await db.from("strava_tokens").update({
    athlete_id: t.athlete?.id ?? null, access_token: t.access_token, refresh_token: t.refresh_token,
    expires_at: t.expires_at, state: null, last_sync: START, updated_at: new Date().toISOString(),
  }).eq("user_id", row.user_id);
  return back("ok");
}

async function sync(userId: string) {
  const { data: row } = await db.from("strava_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!row?.refresh_token) return { connected: false };
  const at = await accessToken(row);
  // 2 päivän päällekkäisyys, jotta myöhässä synkronoidut suoritukset eivät jää väliin; id estää tuplat.
  const after = Math.max(START, (row.last_sync ?? START) - 2 * 86400);
  // deno-lint-ignore no-explicit-any
  let acts: any[] = [];
  for (let page = 1; page <= 5; page++) {
    const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${after}&per_page=100&page=${page}`, {
      headers: { Authorization: `Bearer ${at}` },
    });
    if (!r.ok) throw new Error(`Strava activities ${r.status}`);
    const a = await r.json();
    acts = acts.concat(a);
    if (a.length < 100) break;
  }
  let added = 0, merged = 0, last = row.last_sync ?? START;
  for (const a of acts) {
    const date = String(a.start_date_local).slice(0, 10);
    const sport = SPORT[a.sport_type] ?? "free";
    const dur = Math.min(1440, Math.max(1, Math.round((a.moving_time || a.elapsed_time || 60) / 60)));
    const dist = a.distance > 0 && sport !== "str" && sport !== "func" ? Math.round(a.distance / 10) / 100 : null;
    const hr = a.average_heartrate ? Math.round(a.average_heartrate) : null;
    last = Math.max(last, Math.floor(Date.parse(a.start_date) / 1000));
    // Sama päivä ja laji jo kirjattu käsin: täydennetään matka ja syke, ei luoda tuplaa.
    const { data: same } = await db.from("entries").select("id,dist,hr")
      .eq("user_id", userId).eq("date", date).eq("sport", sport).not("id", "like", "strava-%").limit(1);
    if (same && same.length) {
      const m = same[0], patch: Record<string, number> = {};
      if (m.dist == null && dist) patch.dist = dist;
      if (m.hr == null && hr) patch.hr = hr;
      if (Object.keys(patch).length) { await db.from("entries").update(patch).eq("id", m.id); merged++; }
      continue;
    }
    const { data: ins } = await db.from("entries").upsert(
      { id: `strava-${a.id}`, user_id: userId, date, sport, dur, dist, hr, title: a.name ?? "", note: "" },
      { onConflict: "id", ignoreDuplicates: true },
    ).select("id");
    if (ins && ins.length) added++;
  }
  await db.from("strava_tokens").update({ last_sync: last, updated_at: new Date().toISOString() }).eq("user_id", userId);
  return { connected: true, added, merged, athlete: row.athlete_id };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const u = new URL(req.url), action = u.searchParams.get("action");
  try {
    if (action === "callback") return await callback(u);
    const user = await userOf(req);
    if (!user) return json({ error: "Kirjaudu sisään." }, 401);
    if (!CID || !CSECRET) return json({ error: "Strava-salaisuudet puuttuvat Supabasesta." }, 500);
    if (action === "start") {
      const state = crypto.randomUUID();
      await db.from("strava_tokens").upsert({ user_id: user.id, state }, { onConflict: "user_id" });
      const url = `https://www.strava.com/oauth/authorize?client_id=${CID}&response_type=code&redirect_uri=${encodeURIComponent(REDIRECT)}&approval_prompt=auto&scope=read,activity:read_all&state=${state}`;
      return json({ url });
    }
    if (action === "sync") return json(await sync(user.id));
    if (action === "disconnect") {
      const { data: row } = await db.from("strava_tokens").select("*").eq("user_id", user.id).maybeSingle();
      if (row?.refresh_token) {
        try { await fetch("https://www.strava.com/oauth/deauthorize", { method: "POST", headers: { Authorization: `Bearer ${await accessToken(row)}` } }); } catch (_) { /* yhteys poistetaan silti */ }
      }
      await db.from("strava_tokens").delete().eq("user_id", user.id);
      return json({ connected: false });
    }
    return json({ error: "Tuntematon toiminto." }, 400);
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 500);
  }
});
