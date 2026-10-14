// Strava-yhteys Norseman-treenipäiväkirjalle (Supabase Edge Function "strava").
// Toiminnot (?action=): start, callback, sync, backfill, disconnect.
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

// Kestävyyslajeille tuodaan tarkat tiedot: kilometriajat, kierrokset ja syke-/vauhtikäyrä.
const DETAIL_SPORTS = new Set(["run", "bike", "swim", "erg"]);
const MAX_DETAILS = 25; // per kutsu, Stravan rajoitus on 100 pyyntöä / 15 min
const r1 = (x: number | null | undefined, k = 1) => x == null ? null : Math.round(x * k) / k;

// Tasaa käyrän enintään n pisteeseen (keskiarvo per lohko).
function down(arr: (number | null)[] | undefined, n: number) {
  if (!arr || !arr.length) return null;
  if (arr.length <= n) return arr;
  const out: (number | null)[] = [], step = arr.length / n;
  for (let i = 0; i < n; i++) {
    const seg = arr.slice(Math.floor(i * step), Math.floor((i + 1) * step)).filter((x) => x != null) as number[];
    out.push(seg.length ? seg.reduce((a, b) => a + b, 0) / seg.length : null);
  }
  return out;
}

async function fetchDetails(at: string, sid: number) {
  const h = { headers: { Authorization: `Bearer ${at}` } };
  const [ra, rs] = await Promise.all([
    fetch(`https://www.strava.com/api/v3/activities/${sid}`, h),
    fetch(`https://www.strava.com/api/v3/activities/${sid}/streams?keys=time,distance,heartrate,velocity_smooth,altitude&key_by_type=true`, h),
  ]);
  if (!ra.ok) throw new Error(`Strava activity ${ra.status}`);
  const a = await ra.json();
  // deno-lint-ignore no-explicit-any
  const st: Record<string, any> = rs.ok ? await rs.json() : {};
  const N = 300;
  const d = down(st.distance?.data, N), hr = down(st.heartrate?.data, N), v = down(st.velocity_smooth?.data, N), alt = down(st.altitude?.data, N);
  return {
    sid, src: "strava",
    moving: a.moving_time, elapsed: a.elapsed_time, dist: a.distance,
    avgV: r1(a.average_speed, 100), maxV: r1(a.max_speed, 100),
    avgHr: r1(a.average_heartrate), maxHr: r1(a.max_heartrate),
    elev: r1(a.total_elevation_gain), cad: r1(a.average_cadence), watts: r1(a.average_watts),
    // deno-lint-ignore no-explicit-any
    splits: (a.splits_metric ?? []).map((x: any) => ({ d: r1(x.distance), t: x.moving_time, hr: r1(x.average_heartrate), el: r1(x.elevation_difference) })),
    // deno-lint-ignore no-explicit-any
    laps: (a.laps ?? []).map((x: any) => ({ d: r1(x.distance), t: x.moving_time, hr: r1(x.average_heartrate) })),
    s: d ? { d: d.map((x) => r1(x)), hr: hr?.map((x) => r1(x)) ?? null, v: v?.map((x) => r1(x, 100)) ?? null, alt: alt?.map((x) => r1(x)) ?? null } : null,
  };
}

async function attachDetails(at: string, entryId: string, sid: number) {
  const details = await fetchDetails(at, sid);
  await db.from("entries").update({ details }).eq("id", entryId);
}

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
  let added = 0, merged = 0, detailed = 0, last = row.last_sync ?? START;
  const withDetails = async (entryId: string, a: { id: number }, sport: string) => {
    if (!DETAIL_SPORTS.has(sport) || detailed >= MAX_DETAILS) return;
    try { await attachDetails(at, entryId, a.id); detailed++; } catch (_) { /* perustiedot jäävät, tiedot haetaan myöhemmin backfillillä */ }
  };
  for (const a of acts) {
    const date = String(a.start_date_local).slice(0, 10);
    const sport = SPORT[a.sport_type] ?? "free";
    const dur = Math.min(1440, Math.max(1, Math.round((a.moving_time || a.elapsed_time || 60) / 60)));
    const dist = a.distance > 0 && sport !== "str" && sport !== "func" ? Math.round(a.distance / 10) / 100 : null;
    const hr = a.average_heartrate ? Math.round(a.average_heartrate) : null;
    last = Math.max(last, Math.floor(Date.parse(a.start_date) / 1000));
    // Sama päivä ja laji jo kirjattu käsin: täydennetään matka ja syke, ei luoda tuplaa.
    const { data: same } = await db.from("entries").select("id,dist,hr,details")
      .eq("user_id", userId).eq("date", date).eq("sport", sport).not("id", "like", "strava-%").limit(1);
    if (same && same.length) {
      const m = same[0], patch: Record<string, number> = {};
      if (m.dist == null && dist) patch.dist = dist;
      if (m.hr == null && hr) patch.hr = hr;
      if (Object.keys(patch).length) { await db.from("entries").update(patch).eq("id", m.id); merged++; }
      if (!m.details) await withDetails(m.id, a, sport);
      continue;
    }
    const { data: ins } = await db.from("entries").upsert(
      { id: `strava-${a.id}`, user_id: userId, date, sport, dur, dist, hr, title: a.name ?? "", note: "" },
      { onConflict: "id", ignoreDuplicates: true },
    ).select("id");
    if (ins && ins.length) { added++; await withDetails(`strava-${a.id}`, a, sport); }
  }
  await db.from("strava_tokens").update({ last_sync: last, updated_at: new Date().toISOString() }).eq("user_id", userId);
  return { connected: true, added, merged, detailed, athlete: row.athlete_id };
}

// Tarkat tiedot jo tuoduille ja käsin kirjatuille kestävyyssuorituksille. Ei luo uusia rivejä.
async function backfill(userId: string) {
  const { data: row } = await db.from("strava_tokens").select("*").eq("user_id", userId).maybeSingle();
  if (!row?.refresh_token) return { connected: false };
  const at = await accessToken(row);
  const { data: rows } = await db.from("entries").select("id,date,sport,details").eq("user_id", userId).gte("date", "2026-10-05").is("details", null);
  const missing = (rows ?? []).filter((e) => DETAIL_SPORTS.has(e.sport));
  if (!missing.length) return { connected: true, detailed: 0, left: 0 };
  const r = await fetch(`https://www.strava.com/api/v3/athlete/activities?after=${START}&per_page=200`, { headers: { Authorization: `Bearer ${at}` } });
  if (!r.ok) throw new Error(`Strava activities ${r.status}`);
  const acts = await r.json();
  let detailed = 0;
  const used = new Set<string>();
  for (const a of acts) {
    if (detailed >= MAX_DETAILS) break;
    const sport = SPORT[a.sport_type] ?? "free";
    if (!DETAIL_SPORTS.has(sport)) continue;
    const date = String(a.start_date_local).slice(0, 10);
    const e = missing.find((x) => x.id === `strava-${a.id}`) ?? missing.find((x) => !used.has(x.id) && !x.id.startsWith("strava-") && x.date === date && x.sport === sport);
    if (!e || used.has(e.id)) continue;
    used.add(e.id);
    try { await attachDetails(at, e.id, a.id); detailed++; } catch (_) { /* yritetään seuraavalla kerralla */ }
  }
  return { connected: true, detailed, left: missing.length - detailed };
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
    if (action === "backfill") return json(await backfill(user.id));
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
