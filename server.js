const express = require('express');
const multer = require('multer');
const nodemailer = require('nodemailer');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const DATA = process.env.DATA_DIR || path.join(__dirname, 'data');
const PASS = process.env.ADMIN_PASSWORD;
const OWNER = process.env.OWNER_EMAIL || process.env.SMTP_USER;
if (!PASS) { console.error('ADMIN_PASSWORD is not set. Refusing to start.'); process.exit(1); }

['art', 'music'].forEach(k => fs.mkdirSync(path.join(DATA, 'uploads', k), { recursive: true }));
const dbFile = path.join(DATA, 'db.json');
let db = { art: [], music: [], commissions: [], stats: { newV: 0, retV: 0, views: 0 } };try { db = { ...db, ...JSON.parse(fs.readFileSync(dbFile, 'utf8')) }; } catch {}
const save = () => { fs.writeFileSync(dbFile + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(dbFile + '.tmp', dbFile); };
const uid = () => crypto.randomBytes(6).toString('hex');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ---------- email ----------
const port = Number(process.env.SMTP_PORT || 465);
const mailer = process.env.SMTP_HOST ? nodemailer.createTransport({
  host: process.env.SMTP_HOST, port, secure: port === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
}) : null;
async function mail(to, subject, html) {
  if (!mailer || !to) return console.log('[email skipped - SMTP not configured]', subject);
  try { await mailer.sendMail({ from: process.env.MAIL_FROM || process.env.SMTP_USER, to, subject, html }); }
  catch (e) { console.error('Email error:', e.message); }
}

// ---------- auth (password wall) ----------
const sessions = new Map();
const tries = new Map();
const getSid = req => ((req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith('sid=')) || '').slice(4);
const authed = req => { const e = sessions.get(getSid(req)); return !!e && e > Date.now(); };
const needAuth = (req, res, next) => authed(req) ? next() : res.status(401).json({ error: 'Password required' });
const sha = s => crypto.createHash('sha256').update(String(s)).digest();

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '100kb' }));

app.post('/api/login', (req, res) => {
  const t = tries.get(req.ip) || { n: 0, until: 0 };
  if (t.until > Date.now()) return res.status(429).json({ error: 'Too many attempts. Try again in 15 minutes.' });
  if (!crypto.timingSafeEqual(sha(req.body.password || ''), sha(PASS))) {
    t.n++; if (t.n >= 5) { t.until = Date.now() + 15 * 60e3; t.n = 0; }
    tries.set(req.ip, t);
    return res.status(401).json({ error: 'Wrong password' });
  }
  tries.delete(req.ip);
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, Date.now() + 12 * 3600e3);
  res.setHeader('Set-Cookie', `sid=${sid}; HttpOnly; SameSite=Strict; Path=/; Max-Age=43200${req.secure ? '; Secure' : ''}`);
  res.json({ ok: true });
});
app.post('/api/logout', (req, res) => { sessions.delete(getSid(req)); res.setHeader('Set-Cookie', 'sid=; Path=/; Max-Age=0'); res.json({ ok: true }); });
app.get('/api/me', (req, res) => res.json({ admin: authed(req) }));

// ---------- uploads (admin only) ----------
const rules = { art: ['.png'], music: ['.wav', '.mp3'] };
const uploader = kind => multer({
  storage: multer.diskStorage({
    destination: (q, f, cb) => cb(null, path.join(DATA, 'uploads', kind)),
    filename: (q, f, cb) => cb(null, uid() + path.extname(f.originalname).toLowerCase())
  }),
  limits: { fileSize: 60 * 1024 * 1024 },
  fileFilter: (q, f, cb) => cb(null, rules[kind].includes(path.extname(f.originalname).toLowerCase()))
}).single('file');

function magicOk(kind, file) {
  const b = Buffer.alloc(12); const fd = fs.openSync(file, 'r'); fs.readSync(fd, b, 0, 12, 0); fs.closeSync(fd);
  if (kind === 'art') return b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  if (path.extname(file) === '.wav') return b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WAVE';
  return b.toString('ascii', 0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0);
}
app.post('/api/upload/:kind', needAuth, (req, res) => {
  const kind = req.params.kind;
  if (!rules[kind]) return res.sendStatus(404);
  uploader(kind)(req, res, err => {
    if (err) return res.status(400).json({ error: err.message });
    if (!req.file) return res.status(400).json({ error: kind === 'art' ? 'Only PNG files are allowed.' : 'Only WAV or MP3 files are allowed.' });
    if (!magicOk(kind, req.file.path)) { fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'That file is not a real ' + (kind === 'art' ? 'PNG.' : 'WAV/MP3.') }); }
    const item = { id: uid(), title: String(req.body.title || req.file.originalname).slice(0, 80), file: req.file.filename, created: Date.now() };
    db[kind].unshift(item); save(); res.json(item);
  });
});
app.delete('/api/item/:kind/:id', needAuth, (req, res) => {
  const { kind, id } = req.params;
  if (!rules[kind]) return res.sendStatus(404);
  const i = db[kind].findIndex(x => x.id === id);
  if (i < 0) return res.sendStatus(404);
  fs.unlink(path.join(DATA, 'uploads', kind, db[kind][i].file), () => {});
  db[kind].splice(i, 1); save(); res.json({ ok: true });
});
app.use('/files', express.static(path.join(DATA, 'uploads'), { index: false, dotfiles: 'deny' }));

// ---------- public ----------
app.get('/api/gallery', (req, res) => res.json({ art: db.art, music: db.music }));

const shortName = n => {
  const p = String(n).trim().split(/\s+/);
  return p.length > 1 ? `${p[0]} ${p[1][0].toUpperCase()}.` : (p[0].length > 3 ? p[0].slice(0, 3) + '***' : p[0]);
};
app.get('/api/queue', (req, res) => {
  const list = db.commissions.filter(c => !['requested', 'declined'].includes(c.status) && !c.hidden)
    .sort((a, b) => a.order - b.order)
    .map(c => ({ name: shortName(c.name), type: c.type, status: c.status }));
  res.json(list);
});

const reqLog = new Map();
app.post('/api/request', async (req, res) => {
  const b = req.body || {};
  if (b.website) return res.json({ ok: true }); // honeypot
  const hits = (reqLog.get(req.ip) || []).filter(t => t > Date.now() - 3600e3);
  if (hits.length >= 5) return res.status(429).json({ error: 'Too many requests. Try again later.' });
    const name = String(b.name || '').trim().slice(0, 60), email = String(b.email || '').trim().slice(0, 120);
  const discord = String(b.discord || '').trim().slice(0, 60);
  const description = String(b.description || '').trim().slice(0, 3000);
  if (!discord || !description) return res.status(400).json({ error: 'Your Discord username and a description are required.' });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error: 'That email address does not look valid.' });
  if (!b.tos) return res.status(400).json({ error: 'You need to agree to the TOS.' });
  hits.push(Date.now()); reqLog.set(req.ip, hits);
  const c = {
    id: uid(), name: name || discord, email, discord,    type: ['art', 'music', 'sfx'].includes(b.type) ? b.type : 'art',
    description, refs: String(b.refs || '').slice(0, 1000), budget: String(b.budget || '').slice(0, 40),
    commercial: !!b.commercial, rushed: !!b.rushed, status: 'requested', price: '', due: '', notes: '',
    hidden: false, created: Date.now(), order: Date.now()
  };
  db.commissions.push(c); save();
  mail(OWNER, `New ${c.type} commission request from ${c.name}`, `
    <h2>New commission request</h2>
    <p><b>${esc(c.name)}</b> · Discord: ${esc(c.discord)} · Email: ${esc(c.email) || 'not given'}</p>    <p>Type: ${c.type} · Commercial: ${c.commercial ? 'YES' : 'no'} · Rushed: ${c.rushed ? 'YES' : 'no'} · Budget: ${esc(c.budget) || '-'}</p>
    <p>${esc(c.description).replace(/\n/g, '<br>')}</p><p>References: ${esc(c.refs) || '-'}</p>`);
    if (c.email) mail(c.email, 'Got your commission request!', `<p>Hi ${esc(c.name)},</p>
    <p>Thanks for your request. I'll reply with a final price using your email${c.discord ? ' or Discord' : ''}. Once initial payment is received, I'll start and you can follow progress in the public queue.</p><p>- Johnathan</p>`);
  res.json({ ok: true });
});
// ---------- visitor counter ----------
const getCookie = (req, n) => ((req.headers.cookie || '').split(';').map(s => s.trim()).find(s => s.startsWith(n + '=')) || '').slice(n.length + 1);
const isBot = ua => /bot|crawl|spider|slurp|preview|facebookexternalhit|curl|wget/i.test(ua || '');
app.post('/api/visit', (req, res) => {
  if (authed(req) || isBot(req.headers['user-agent'])) return res.json(db.stats);
  const s = db.stats, flag = req.secure ? '; Secure' : '', first = Number(getCookie(req, 'vid')), cookies = [];
  s.views++;
  if (!first) {
    s.newV++;
    cookies.push(`vid=${Date.now()}; Path=/; Max-Age=31536000; SameSite=Lax${flag}`);
  } else if (Date.now() - first > 6 * 3600e3 && !getCookie(req, 'rv')) {
    s.retV++;
    cookies.push(`rv=1; Path=/; Max-Age=31536000; SameSite=Lax${flag}`);
  }
  if (cookies.length) res.setHeader('Set-Cookie', cookies);
  save(); res.json(s);
});
app.get('/api/stats', (req, res) => res.json(db.stats));
// ---------- admin: commissions ----------
const sorted = () => db.commissions.slice().sort((a, b) => a.order - b.order);
app.get('/api/admin/commissions', needAuth, (req, res) => res.json(sorted()));
app.patch('/api/admin/commissions/:id', needAuth, async (req, res) => {
  const c = db.commissions.find(x => x.id === req.params.id);
  if (!c) return res.sendStatus(404);
  const b = req.body, before = c.status;
  for (const k of ['status', 'price', 'due', 'notes']) if (typeof b[k] === 'string') c[k] = b[k].slice(0, 1000);
  if (typeof b.hidden === 'boolean') c.hidden = b.hidden;
  save();
  if (b.notify) await mail(c.email, `Update on your commission: ${c.status}`,
    `<p>Hi ${esc(c.name)},</p><p>Your commission status is now <b>${esc(c.status)}</b>${c.due ? ` (target date: ${esc(c.due)})` : ''}${c.price ? `. Price: ${esc(c.price)}` : ''}.</p>${b.message ? `<p>${esc(b.message)}</p>` : ''}<p>- Johnathan</p>`);
  res.json(c);
});
app.post('/api/admin/commissions/:id/move', needAuth, (req, res) => {
  const list = sorted(), i = list.findIndex(x => x.id === req.params.id), j = i + (req.body.dir === 'up' ? -1 : 1);
  if (i < 0 || j < 0 || j >= list.length) return res.json({ ok: true });
  [list[i].order, list[j].order] = [list[j].order, list[i].order]; save(); res.json({ ok: true });
});
app.delete('/api/admin/commissions/:id', needAuth, (req, res) => {
  db.commissions = db.commissions.filter(x => x.id !== req.params.id); save(); res.json({ ok: true });
});

// ---------- daily email reminder ----------
cron.schedule('0 9 * * *', () => {
  const soon = new Date(Date.now() + 2 * 86400e3).toISOString().slice(0, 10);
  const active = sorted().filter(c => !['done', 'declined'].includes(c.status));
  const due = active.filter(c => c.due && c.due <= soon);
  const waiting = active.filter(c => c.status === 'requested');
  if (!due.length && !waiting.length) return;
  const li = c => `<li><b>${esc(c.name)}</b> (${c.type}) - ${c.status}${c.due ? ', due ' + esc(c.due) : ''}</li>`;
  mail(OWNER, 'Commission reminders', `${due.length ? `<h3>Due within 2 days or overdue</h3><ul>${due.map(li).join('')}</ul>` : ''}
    ${waiting.length ? `<h3>Awaiting your reply</h3><ul>${waiting.map(li).join('')}</ul>` : ''}`);
}, { timezone: process.env.TZ_NAME || 'America/New_York' });

app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, () => console.log('Listening on ' + PORT));
