/* Tempo server.
   - Serves the web app from /public.
   - Holds AI API keys on the server (never sent to the browser).
   - Several AI engines can be available at once; the student picks one in the app:
       local  → Ollama on this computer (free, private: text never leaves the device)
       groq   → Groq cloud (free tier, needs GROQ_API_KEY)
       gemini → Google Gemini (free tier, needs GEMINI_API_KEY)
       claude → Claude (needs ANTHROPIC_API_KEY)
     Model overrides: OLLAMA_MODEL, GROQ_MODEL, GEMINI_MODEL, CLAUDE_MODEL.
   - Two AI endpoints: /api/parse (understand what the student typed) and
     /api/coach (answer questions about the plan).
   - No database, no accounts, no logging of what students type.
   With no AI at all, the app still works fully with its offline rule engine. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Anthropic, BadRequestError } = require('@anthropic-ai/sdk');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC = path.join(__dirname, 'public');
const PROMPTS = {
  parse: fs.readFileSync(path.join(__dirname, 'prompts/parse.md'), 'utf8').replace(/<!--[\s\S]*?-->\s*/, ''),
  coach: fs.readFileSync(path.join(__dirname, 'prompts/coach.md'), 'utf8').replace(/<!--[\s\S]*?-->\s*/, ''),
};

// On Netlify there is no Ollama: the local engine only exists when Tempo runs on your own computer.
const HOSTED = !!process.env.TEMPO_HOSTED;
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
// Use at most half the CPU cores for the local model so the laptop stays responsive.
const OLLAMA_THREADS = Number(process.env.OLLAMA_THREADS) || Math.max(2, Math.floor(os.cpus().length / 2));

const PROVIDERS = {
  local: { name: 'Local AI', kind: 'ollama', model: process.env.OLLAMA_MODEL || 'qwen2.5:3b', where: 'on this computer' },
  groq: { name: 'Groq', kind: 'openai', key: 'GROQ_API_KEY', url: process.env.GROQ_URL || 'https://api.groq.com/openai/v1/chat/completions', model: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile', where: 'online' },
  gemini: { name: 'Gemini', kind: 'openai', key: 'GEMINI_API_KEY', url: 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', model: process.env.GEMINI_MODEL || 'gemini-2.5-flash', where: 'online' },
  claude: { name: 'Claude', kind: 'claude', key: 'ANTHROPIC_API_KEY', model: process.env.CLAUDE_MODEL || 'claude-opus-5-5', where: 'online' },
};
const claude = process.env.ANTHROPIC_API_KEY ? new Anthropic() : null;
const err = (msg, status = 502) => Object.assign(new Error(msg), { status });

// Is each engine usable right now? Cloud: key present. Local: Ollama running and model downloaded.
async function providerStatus() {
  const out = [];
  for (const [id, p] of Object.entries(PROVIDERS)) {
    let ready = true, reason = '';
    if (p.kind === 'ollama' && HOSTED) { ready = false; reason = 'only available when Tempo runs on your own computer (npm start)'; }
    else if (p.kind === 'ollama') {
      try {
        const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(1500) });
        const names = ((await r.json()).models || []).map((m) => m.name);
        const want = p.model.includes(':') ? p.model : `${p.model}:latest`;
        if (!names.includes(want)) { ready = false; reason = `run: ollama pull ${p.model}`; }
      } catch { ready = false; reason = 'Ollama is not running (start it with: ollama serve)'; }
    } else if (!process.env[p.key]) { ready = false; reason = `set ${p.key}`; }
    // hide cloud engines with no key, except Groq so the toggle always shows both choices
    if (ready || p.kind === 'ollama' || id === 'groq') out.push({ id, name: p.name, model: p.model, where: p.where, ready, reason });
  }
  return out;
}

// JSON schema the model's answer must follow (structured outputs).
const nullable = (t) => ({ type: [t, 'null'] });
const PARSE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['items', 'commitments', 'availability', 'changes', 'questions'],
  properties: {
    items: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['kind', 'title', 'subject', 'dueText', 'due', 'estText', 'estMin', 'difficultyText', 'difficulty', 'assumed'],
      properties: { kind: { type: 'string', enum: ['assignment', 'exam'] }, title: { type: 'string' }, subject: { type: 'string' },
        dueText: nullable('string'), due: nullable('string'), estText: nullable('string'), estMin: nullable('integer'), difficultyText: nullable('string'), difficulty: nullable('integer'), assumed: { type: 'array', items: { type: 'string' } } } } },
    commitments: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['title', 'whenText', 'days', 'date', 'start', 'end', 'assumed'],
      properties: { title: { type: 'string' }, whenText: nullable('string'), days: { type: 'array', items: { type: 'integer' } }, date: nullable('string'),
        start: nullable('string'), end: nullable('string'), assumed: { type: 'array', items: { type: 'string' } } } } },
    availability: { type: 'object', additionalProperties: false, required: ['text', 'dailyMinutes', 'weekendMinutes'],
      properties: { text: nullable('string'), dailyMinutes: nullable('integer'), weekendMinutes: nullable('integer') } },
    changes: { type: 'array', items: { type: 'object', additionalProperties: false,
      required: ['itemId', 'due', 'estMin', 'remove', 'done'],
      properties: { itemId: { type: 'string' }, due: nullable('string'), estMin: nullable('integer'), remove: { type: 'boolean' }, done: { type: 'boolean' } } } },
    questions: { type: 'array', items: { type: 'string' } },
  },
};

// For the local model: same schema plus length limits. Ollama enforces the schema while
// generating, so this stops a small model from looping ("What is…? What is…?" forever).
function capped(schema) {
  const c = JSON.parse(JSON.stringify(schema)), P = c.properties;
  P.items.maxItems = 12; P.commitments.maxItems = 8; P.changes.maxItems = 12; P.questions.maxItems = 4;
  P.questions.items.maxLength = 160;
  P.items.items.properties.assumed.maxItems = 4; P.commitments.items.properties.assumed.maxItems = 4;
  P.commitments.items.properties.days.maxItems = 7;
  return c;
}
const LOCAL_SCHEMA = capped(PARSE_SCHEMA);

// One call to Claude. Uses server-side refusal fallbacks; if this account/SDK
// doesn't accept that beta, retries as a plain request.
async function askClaude(p, { system, user, schema, maxTokens }) {
  const params = {
    model: p.model, max_tokens: maxTokens, system,
    messages: [{ role: 'user', content: user }],
    output_config: { effort: 'low', ...(schema ? { format: { type: 'json_schema', schema } } : {}) },
  };
  let msg;
  try {
    msg = await claude.beta.messages.create({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' });
  } catch (e) {
    if (e instanceof BadRequestError) msg = await claude.messages.create(params);
    else throw e;
  }
  if (msg.stop_reason === 'refusal') throw err('The AI declined this request.', 422);
  if (msg.stop_reason === 'max_tokens') throw err('The AI response was cut off.');
  return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
}

// Groq / Gemini (OpenAI-compatible). They don't all enforce a schema, so we describe
// the shape in the prompt and ask for JSON mode; sanitize() in the browser checks everything.
async function askOpenAICompatible(p, { system, user, schema, maxTokens }) {
  const sys = schema ? `${system}\n\nReply with ONLY a JSON object (no markdown, no explanation) matching this JSON schema:\n${JSON.stringify(schema)}` : system;
  const body = { model: p.model, max_tokens: maxTokens, temperature: schema ? 0 : 0.4,
    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    ...(schema ? { response_format: { type: 'json_object' } } : {}) };
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env[p.key]}` };
  const call = (b) => fetch(p.url, { method: 'POST', headers, body: JSON.stringify(b), signal: AbortSignal.timeout(45000) });
  let res = await call(body);
  if (res.status === 400 && schema) { delete body.response_format; res = await call(body); } // some models lack JSON mode
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 200);
    throw err(`${p.name} error ${res.status}${res.status === 429 ? ' (free-tier limit, wait a minute)' : ''}: ${detail}`, res.status === 429 ? 429 : 502);
  }
  const j = await res.json();
  const choice = j.choices && j.choices[0];
  if (!choice) throw err(`${p.name} returned no answer`);
  if (choice.finish_reason === 'length') throw err('The AI response was cut off.');
  return choice.message.content || '';
}

// Local model through Ollama's native API. `format: schema` makes Ollama constrain the
// output to our JSON schema, so even a small 3B model returns well-formed JSON.
async function askOllama(p, { system, user, schema, maxTokens }) {
  const sys = schema ? `${system}\n\nReply with ONLY a JSON object matching the required schema.` : system;
  const body = {
    model: p.model, stream: false, keep_alive: '30m',
    messages: [{ role: 'system', content: sys }, { role: 'user', content: user }],
    ...(schema ? { format: schema === PARSE_SCHEMA ? LOCAL_SCHEMA : schema } : {}),
    options: { temperature: schema ? 0 : 0.4, num_ctx: 8192, num_predict: maxTokens, num_thread: OLLAMA_THREADS },
  };
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
  } catch (e) {
    throw err(e.name === 'TimeoutError' ? 'The local AI took too long.' : 'Local AI is not running (start Ollama).', 503);
  }
  if (!res.ok) throw err(`Local AI error ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = await res.json();
  if (j.done_reason === 'length') throw err('The AI response was cut off.');
  return (j.message && j.message.content) || '';
}

const ASK = { claude: askClaude, openai: askOpenAICompatible, ollama: askOllama };
function ask(id, o) {
  const p = Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id] : null;
  if (!p) throw err('Unknown AI engine', 400);
  if (p.kind === 'ollama' && HOSTED) throw err('Local AI only works when Tempo runs on your own computer (npm start). Online, use Groq or the offline rules.', 503);
  if (p.key && !process.env[p.key]) throw err(`${p.name} is not set up on the server (missing ${p.key}).`, 503);
  return ASK[p.kind](p, { maxTokens: 1500, ...o });
}

// Pull a JSON object out of a reply even if a model wraps it in ```json fences.
function extractJSON(text) {
  try { return JSON.parse(text); } catch { /* fall through */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (m) { try { return JSON.parse(m[0]); } catch { /* fall through */ } }
  throw Object.assign(new Error('The AI did not return valid JSON'), { status: 502 });
}

// A lookup calendar for the next 3 weeks. Small models are bad at date arithmetic
// ("next Wednesday" → a Saturday), so we give them the answers to look up instead.
function calendar(today) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(today || ''));
  const t0 = m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : Date.now();
  const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const dow0 = new Date(t0).getUTCDay(), toMon = (dow0 + 6) % 7; // days since this week's Monday
  const weeks = ['THIS WEEK', 'NEXT WEEK', 'WEEK AFTER NEXT'];
  const lines = [];
  for (let w = 0; w < 3; w++) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const off = w * 7 + d - toMon, dt = new Date(t0 + off * 864e5);
      const iso = dt.toISOString().slice(0, 10), name = DAYS[dt.getUTCDay()];
      days.push(off < 0 ? `${name} ${iso} (past)` : off === 0 ? `${name} ${iso} (TODAY)` : `${name} ${iso}`);
    }
    lines.push(`${weeks[w]}: ${days.join(', ')}`);
  }
  return `CALENDAR (look dates up here, do not calculate):\n${lines.join('\n')}\nWeekday numbers for "days": Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6.`;
}

// tiny per-IP rate limit so a shared demo key can't be abused
const hits = new Map();
function limited(ip) {
  const now = Date.now(), w = (hits.get(ip) || []).filter((t) => now - t < 60000);
  w.push(now); hits.set(ip, w); return w.length > 30;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 50000) { reject(Object.assign(new Error('Too large'), { status: 413 })); req.destroy(); } });
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { reject(Object.assign(new Error('Bad JSON'), { status: 400 })); } });
  });
}

const send = (res, status, obj) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' };

// All API logic lives here so it runs the same on a laptop (server.js) and on
// Netlify (netlify/functions/api.js). Returns [status, json].
async function handleApi(pathname, method, readJson, ip) {
  try {
    if (pathname === '/api/status') {
      const providers = await providerStatus();
      return [200, { providers, ai: providers.some((p) => p.ready), hosted: HOSTED }];
    }
    if (method !== 'POST') return [405, { error: 'POST only' }];
    if (limited(ip)) return [429, { error: 'Slow down a little — try again in a minute.' }];
    const body = await readJson();
    const pid = String(body.provider || 'local');
    if (!Object.hasOwn(PROVIDERS, pid)) return [400, { error: 'Unknown AI engine' }];

    if (pathname === '/api/parse') {
      const text = String(body.text || '').slice(0, 4000);
      const existing = (body.existing || []).slice(0, 60).map((e) => ({ id: String(e.id), title: String(e.title), subject: String(e.subject || ''), kind: String(e.kind), due: e.due || null }));
      const user = `Today is ${body.today} (${body.weekday}).\n\n${calendar(body.today)}\n\nExisting tasks:\n${JSON.stringify(existing)}\n\nThe student wrote:\n"""\n${text}\n"""`;
      const out = await ask(pid, { system: PROMPTS.parse, user, schema: PARSE_SCHEMA });
      return [200, { ...extractJSON(out), engine: PROVIDERS[pid].name }];
    }
    if (pathname === '/api/coach') {
      const question = String(body.question || '').slice(0, 1000);
      const context = String(body.context || '').slice(0, 12000);
      const answer = await ask(pid, { system: PROMPTS.coach, user: `PLAN DATA:\n${context}\n\nSTUDENT QUESTION:\n${question}`, maxTokens: 600 });
      return [200, { answer, provider: PROVIDERS[pid].name }];
    }
    return [404, { error: 'Unknown endpoint' }];
  } catch (e) {
    const status = e.status && e.status >= 400 && e.status < 600 ? e.status : 500;
    console.error(`[${new Date().toISOString()}] ${pathname} → ${status}: ${e.message}`); // no student text in logs
    return [status, { error: e.message || 'Something went wrong' }];
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      const [status, obj] = await handleApi(url.pathname, req.method, () => readBody(req), req.socket.remoteAddress);
      return send(res, status, obj);
    }

    // static files
    let file = path.normalize(path.join(PUBLIC, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
    if (!file.startsWith(PUBLIC)) return send(res, 403, { error: 'Forbidden' });
    fs.readFile(file, (err, buf) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      res.end(buf);
    });
  } catch (e) {
    const status = e.status && e.status < 600 ? e.status : 500;
    console.error(`[${new Date().toISOString()}] ${url.pathname} → ${status}: ${e.message}`); // no student text in logs
    send(res, status >= 400 ? status : 500, { error: e.message || 'Something went wrong' });
  }
});

module.exports = { handleApi };

if (require.main === module) server.listen(PORT, async () => {
  console.log(`\n  Tempo is running →  http://localhost:${PORT}`);
  for (const p of await providerStatus()) console.log(`  ${p.ready ? '✓' : '✗'} ${p.name} (${p.model})${p.ready ? '' : ' — ' + p.reason}`);
  console.log('  ✓ Offline rule engine (always available)');
});
