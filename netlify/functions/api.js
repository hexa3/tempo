/* Netlify Function: runs the same API code as server.js.
   Netlify serves /public as a static site; netlify.toml sends /api/* here.
   Set GROQ_API_KEY (and optionally GEMINI_API_KEY) in Netlify → Site configuration → Environment variables. */
process.env.TEMPO_HOSTED = '1';
const { handleApi } = require('../../server.js');

exports.handler = async (event) => {
  const name = event.path.split('/').filter(Boolean).pop(); // works for /api/x and /.netlify/functions/api/x
  const readJson = async () => {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    if (raw.length > 50000) throw Object.assign(new Error('Too large'), { status: 413 });
    try { return JSON.parse(raw || '{}'); } catch { throw Object.assign(new Error('Bad JSON'), { status: 400 }); }
  };
  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['x-forwarded-for'] || 'unknown';
  const [status, obj] = await handleApi(`/api/${name}`, event.httpMethod, readJson, ip);
  return { statusCode: status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(obj) };
};
