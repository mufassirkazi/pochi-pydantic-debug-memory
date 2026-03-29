/**
 * scripts/simulate-users.js
 *
 * Drives 30 realistic users through the full Lumina AI flow via the REST API:
 *   1. POST /session/login     → creates user, assigns variant
 *   2. GET  /onboarding/for-user → triggers onboarding_served event
 *   3. POST /onboarding/complete → marks done
 *   4. POST /generate-image      → 1-3 images per user
 *   5. POST /session/logout
 *
 * Each user gets a dedicated cookie jar (http.Agent with manual cookie handling).
 * Run with: node scripts/simulate-users.js
 */

"use strict";

const http = require("http");

const BASE = "http://localhost:3000";

// ── 30 diverse test users ─────────────────────────────────────────────────
const USERS = [
  { email: "alice.chen@designstudio.io",      prompts: ["minimalist logo blue waves", "abstract geometric brand mark"] },
  { email: "bob.martinez@techcorp.dev",        prompts: ["futuristic robot portrait cinematic"] },
  { email: "carol.johnson@freelance.art",      prompts: ["watercolor botanical illustration roses", "ink sketch owl night sky"] },
  { email: "david.kim@startup.co",             prompts: ["product shot wireless headphones marble"] },
  { email: "eve.patel@agency.design",          prompts: ["vintage travel poster tokyo neon", "retro 80s synthwave landscape"] },
  { email: "frank.osei@photography.studio",   prompts: ["dramatic portrait golden hour backlit"] },
  { email: "grace.liu@games.studio",           prompts: ["fantasy dragon castle epic battle", "pixel art hero character sword"] },
  { email: "henry.nguyen@marketing.team",      prompts: ["flat design icons social media", "bright colorful infographic charts"] },
  { email: "iris.stone@branding.co",           prompts: ["luxury perfume bottle black gold"] },
  { email: "james.white@creative.agency",      prompts: ["street art mural city urban graffiti", "neon signs rainy night reflections"] },
  { email: "kate.brown@illustration.io",       prompts: ["cute mascot character coffee shop", "hand drawn doodle pattern colorful"] },
  { email: "liam.taylor@ux.design",            prompts: ["clean ui mockup mobile app dashboard"] },
  { email: "maya.garcia@fashion.brand",        prompts: ["editorial fashion model editorial", "minimalist clothing product flat lay"] },
  { email: "noah.wilson@architecture.firm",    prompts: ["modern architecture exterior glass steel", "interior design living room scandinavian"] },
  { email: "olivia.moore@food.blog",           prompts: ["overhead shot gourmet pasta fresh herbs", "artisan coffee latte art close-up"] },
  { email: "peter.clark@music.prod",           prompts: ["album cover dark moody atmospheric"] },
  { email: "quinn.harris@animation.studio",    prompts: ["3d render cartoon character cute", "anime style girl cherry blossoms"] },
  { email: "ruby.davis@ecom.store",            prompts: ["luxury watch product photography", "jewelry ring diamond white background"] },
  { email: "sam.miller@tech.blog",             prompts: ["abstract data visualization glowing lines"] },
  { email: "tina.baker@events.co",             prompts: ["elegant wedding invitation floral gold", "celebration party colorful confetti"] },
  { email: "uma.anderson@art.gallery",         prompts: ["surrealist painting melting clocks", "impressionist style sunset ocean"] },
  { email: "victor.hall@film.prod",            prompts: ["cinematic movie poster thriller dark", "dramatic lighting hero shadow"] },
  { email: "wendy.young@nature.photo",         prompts: ["misty forest morning light ethereal", "wildlife eagle mountains dramatic"] },
  { email: "xavier.lewis@sports.brand",        prompts: ["action sports poster athlete dynamic", "bold typography motivational poster"] },
  { email: "yara.walker@wellness.app",         prompts: ["zen meditation peaceful lotus water"] },
  { email: "zoe.scott@kids.brand",             prompts: ["playful cartoon animals rainbow bright", "cute teddy bear soft toys illustration"] },
  { email: "alex.turner@podcast.studio",       prompts: ["podcast cover art microphone dark moody"] },
  { email: "blake.morgan@nft.creator",         prompts: ["generative art abstract crypto punk", "vaporwave aesthetic glitch art digital"] },
  { email: "casey.reed@travel.blog",           prompts: ["travel photo collage world map", "exotic beach tropical paradise aerial"] },
  { email: "drew.brooks@ai.startup",           prompts: ["neural network visualization abstract", "futuristic city holographic interface"] },
];

const STYLES = ["Photorealistic", "Digital art", "Watercolor", "Oil painting", "Anime", "3D render", null, null];

function randomStyle() {
  return STYLES[Math.floor(Math.random() * STYLES.length)];
}

// ── Minimal HTTP helper (Node built-in, no fetch needed) ──────────────────
function request(method, path, body, cookies) {
  return new Promise((resolve, reject) => {
    const data  = body ? JSON.stringify(body) : null;
    const opts  = {
      hostname: "localhost",
      port:     3000,
      path,
      method,
      headers: {
        "Content-Type":  "application/json",
        "Cookie":        cookies || "",
        ...(data ? { "Content-Length": Buffer.byteLength(data) } : {}),
      },
    };

    const req = http.request(opts, (res) => {
      let raw = "";
      res.on("data", (c) => (raw += c));
      res.on("end", () => {
        try {
          const setCookie = res.headers["set-cookie"] || [];
          resolve({ status: res.statusCode, body: JSON.parse(raw), setCookie });
        } catch {
          resolve({ status: res.statusCode, body: raw, setCookie: [] });
        }
      });
    });

    req.on("error", reject);
    if (data) req.write(data);
    req.end();
  });
}

function extractSessionCookie(setCookieHeaders) {
  for (const h of setCookieHeaders) {
    const match = h.match(/lumina\.sid=([^;]+)/);
    if (match) return `lumina.sid=${match[1]}`;
  }
  return "";
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ── Simulate one user ─────────────────────────────────────────────────────
async function simulateUser(user, index) {
  const tag = `[${String(index + 1).padStart(2, "0")}] ${user.email}`;
  let cookie = "";

  try {
    // 1. Login
    const login = await request("POST", "/session/login", { email: user.email }, "");
    if (login.status !== 200) throw new Error(`login failed: ${login.status}`);
    cookie = extractSessionCookie(login.body.redirect ? [] : login.setCookie);
    // Grab cookie from Set-Cookie header
    for (const h of login.setCookie) {
      const m = h.match(/lumina\.sid=([^;]+)/);
      if (m) { cookie = `lumina.sid=${m[1]}`; break; }
    }
    console.log(`${tag} ✓ login  (redirect: ${login.body.redirect})`);

    await sleep(150);

    // 2. Get session/me to confirm cookie
    const me = await request("GET", "/session/me", null, cookie);
    if (me.status !== 200) throw new Error(`/me failed: ${me.status}`);
    // Refresh cookie if updated
    for (const h of me.setCookie) {
      const m = h.match(/lumina\.sid=([^;]+)/);
      if (m) { cookie = `lumina.sid=${m[1]}`; break; }
    }

    await sleep(100);

    // 3. Fetch onboarding (triggers onboarding_served event)
    const ob = await request("GET", "/onboarding/for-user", null, cookie);
    if (ob.status !== 200) throw new Error(`onboarding fetch failed: ${ob.status}`);
    console.log(`${tag} ✓ onboarding_served (variant=${ob.body.variant})`);

    await sleep(300 + Math.random() * 500); // simulate reading time

    // 4. Complete onboarding
    const done = await request("POST", "/onboarding/complete", {}, cookie);
    if (done.status !== 200) throw new Error(`complete failed: ${done.status}`);
    console.log(`${tag} ✓ onboarding_completed`);

    await sleep(200);

    // 5. Generate images (1 to 3 per user)
    const numImages = Math.min(user.prompts.length, 1 + Math.floor(Math.random() * 3));
    for (let i = 0; i < numImages; i++) {
      const prompt = user.prompts[i % user.prompts.length];
      const style  = randomStyle();
      const gen = await request("POST", "/generate-image", { prompt, style }, cookie);
      if (gen.status !== 200) throw new Error(`generate failed: ${gen.status} for "${prompt}"`);
      console.log(`${tag} ✓ image_generated  "${prompt.slice(0, 40)}"${style ? ` [${style}]` : ""}`);
      await sleep(200 + Math.random() * 300);
    }

    // 6. Logout
    const out = await request("POST", "/session/logout", {}, cookie);
    console.log(`${tag} ✓ logout (${out.status})`);

  } catch (err) {
    console.error(`${tag} ✗ ERROR: ${err.message}`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Lumina AI — User Simulation (${USERS.length} users)`);
  console.log(`${"═".repeat(60)}\n`);

  // Check server is up
  try {
    const h = await request("GET", "/health", null, "");
    if (h.status !== 200) throw new Error(`health=${h.status}`);
    console.log("✓ Server is healthy\n");
  } catch (err) {
    console.error(`✗ Server not reachable: ${err.message}`);
    process.exit(1);
  }

  // Run users in small batches of 5 (realistic, avoids hammering)
  const BATCH = 5;
  for (let i = 0; i < USERS.length; i += BATCH) {
    const batch = USERS.slice(i, i + BATCH);
    await Promise.all(batch.map((u, j) => simulateUser(u, i + j)));
    if (i + BATCH < USERS.length) {
      console.log(`\n--- batch ${Math.floor(i / BATCH) + 1} complete, pausing 500ms ---\n`);
      await sleep(500);
    }
  }

  console.log(`\n${"═".repeat(60)}`);
  console.log(`  Simulation complete — ${USERS.length} users processed`);
  console.log(`${"═".repeat(60)}\n`);
}

main().catch(console.error);
