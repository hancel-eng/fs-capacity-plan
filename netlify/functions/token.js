// Netlify Function: token.js
// Fetches and caches a Double HQ API token in Upstash Redis.
// Credentials are stored as Netlify environment variables — never exposed to the browser.

const UPSTASH_URL   = process.env.UPSTASH_REDIS_REST_URL;
const UPSTASH_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN;
const REDIS_KEY     = 'double_token_v2'; // v2 clears the incorrectly cached value
const TTL_SECONDS   = 82800; // 23 hours

// ── Upstash helpers (plain fetch, no npm packages needed) ──────────────
async function redisGet(key) {
  const res = await fetch(`${UPSTASH_URL}/get/${encodeURIComponent(key)}`, {
    headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
  });
  const data = await res.json();
  return data.result || null;
}

async function redisSet(key, seconds, value) {
  // Upstash REST API: POST /set/{key}/{value}/ex/{seconds}
  await fetch(
    `${UPSTASH_URL}/set/${encodeURIComponent(key)}/${encodeURIComponent(value)}/ex/${seconds}`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${UPSTASH_TOKEN}` }
    }
  );
}

// ── Token logic ────────────────────────────────────────────────────────
async function getToken() {
  // 1. Try cached token
  const cached = await redisGet(REDIS_KEY);
  if (cached) return cached;

  // 2. Generate new token
  const res = await fetch('https://api.doublehq.com/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     process.env.DOUBLE_CLIENT_ID,
      client_secret: process.env.DOUBLE_CLIENT_SECRET,
    }).toString()
  });

  if (!res.ok) throw new Error(`Double token request failed: ${res.status}`);
  const data = await res.json();
  if (!data.access_token) throw new Error('No access_token in Double response');

  // 3. Cache in Upstash for 23 hours
  await redisSet(REDIS_KEY, TTL_SECONDS, data.access_token);
  return data.access_token;
}

// ── Handler ────────────────────────────────────────────────────────────
exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  try {
    const token = await getToken();
    return { statusCode: 200, headers, body: JSON.stringify({ token }) };
  } catch (err) {
    console.error('Token function error:', err.message);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
