const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const dbmod = require('./db');
const mongo = require('./mongo');
const { clampReward } = require('./seed');

const { load, boot, mode } = dbmod;
function save(db) {
  dbmod.save(db);
  if (mongo.enabled()) mongo.schedulePush(db);
}

const app = express();
const PORT = process.env.PORT || 3000;
const COOKIE = 'gta_sid';
const MIN_WITHDRAW = 350000;
const CORS_ORIGINS = String(process.env.CORS_ORIGIN || '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

app.set('trust proxy', 1);
app.use(cors({
  origin(origin, cb) {
    if (!origin || CORS_ORIGINS.includes('*') || CORS_ORIGINS.includes(origin)) {
      return cb(null, true);
    }
    return cb(null, false);
  },
  credentials: true
}));
app.use(express.json({ limit: '8mb' }));
app.use(cookieParser());
app.use(express.static(__dirname, { extensions: ['html'] }));

function uid(prefix) {
  return (prefix || 'id') + '-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
}
function now() { return new Date().toISOString(); }
function publicUser(u) {
  if (!u) return null;
  const { password, ...rest } = u;
  return rest;
}
function norm(s) {
  return String(s || '').trim().toLowerCase().replace(/[\s.-]/g, '');
}
function findUser(db, login) {
  const q = norm(login);
  return db.users.find((u) => norm(u.email) === q || norm(u.phone) === q || (q.length >= 8 && norm(u.phone).endsWith(q)));
}
function tokenFrom(req) {
  const auth = String(req.headers.authorization || '');
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, '').trim();
  if (req.headers['x-gta-token']) return String(req.headers['x-gta-token']).trim();
  return req.cookies[COOKIE] || '';
}
function sessionOf(req, db) {
  const token = tokenFrom(req);
  if (!token || !db.sessions || !db.sessions[token]) return null;
  return Object.assign({ token }, db.sessions[token]);
}
function requireUser(req, res, db) {
  const s = sessionOf(req, db);
  if (!s || s.type !== 'member') {
    res.status(401).json({ ok: false, code: 'auth' });
    return null;
  }
  const user = db.users.find((u) => u.email === s.email);
  if (!user) {
    res.status(401).json({ ok: false, code: 'auth' });
    return null;
  }
  return user;
}
function requireAdmin(req, res, db) {
  const s = sessionOf(req, db);
  if (!s || s.type !== 'admin') {
    res.status(401).json({ ok: false, code: 'admin' });
    return null;
  }
  return s;
}
function log(db, admin, action, target, detail) {
  db.activity.unshift({
    id: uid('act'),
    at: now(),
    admin: admin || 'Administrateur',
    action,
    target: target || '',
    detail: detail || ''
  });
  db.activity = db.activity.slice(0, 800);
}
function ensureWallet(user) {
  if (typeof user.balance !== 'number') user.balance = 0;
  if (typeof user.pending !== 'number') user.pending = 0;
  if (!Array.isArray(user.tx)) user.tx = [];
  if (!user.videos || typeof user.videos !== 'object') user.videos = {};
  if (!Array.isArray(user.notifs)) user.notifs = [];
  return user;
}
function setCookie(res, token) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 7 * 24 * 3600 * 1000,
    path: '/'
  });
}
function packLabel(p) {
  return (p.range || '') + ' - ' + (p.name || p.id) + ' (' + new Intl.NumberFormat('fr-FR').format(p.price || 0) + ' FCFA)';
}
function pushNotifToUsers(db, n) {
  const targets = n.to === 'all'
    ? db.users
    : db.users.filter((u) => (n.emails || []).includes(u.email));
  targets.forEach((u) => {
    ensureWallet(u);
    u.notifs.unshift({
      id: n.id + '-' + u.email,
      title: n.title,
      message: n.message,
      at: n.at || now(),
      read: false,
      from: 'admin'
    });
  });
}
function deliverScheduled(db) {
  const t = Date.now();
  db.notifications.forEach((n) => {
    if (n.scheduledAt && !n.delivered && new Date(n.scheduledAt).getTime() <= t) {
      n.delivered = true;
      n.at = now();
      pushNotifToUsers(db, n);
    }
  });
}

app.get('/api/health', (_req, res) => {
  res.json({
    ok: true,
    cloud: true,
    persist: mongo.enabled() ? 'mongo' : mode()
  });
});

app.get('/api/public', (_req, res) => {
  const db = load();
  deliverScheduled(db);
  save(db);
  res.json({
    ok: true,
    settings: db.settings,
    packs: (db.packs || []).filter((p) => p.active !== false),
    testimonials: (db.testimonials || []).filter((t) => t.published),
    videos: (db.videos || []).filter((v) => v.active !== false)
  });
});

app.get('/api/me', (req, res) => {
  const db = load();
  const s = sessionOf(req, db);
  if (!s) return res.json({ ok: true, user: null, admin: null });
  if (s.type === 'admin') return res.json({ ok: true, user: null, admin: { name: s.name, email: s.email } });
  const user = db.users.find((u) => u.email === s.email);
  res.json({ ok: true, user: publicUser(user), admin: null });
});

app.post('/api/register', (req, res) => {
  const db = load();
  const body = req.body || {};
  const email = String(body.email || '').trim().toLowerCase();
  const phone = String(body.phone || '').trim();
  const password = String(body.password || '');
  if (!body.fullname || !email || !password || password.length < 6) {
    return res.status(400).json({ ok: false, code: 'invalid' });
  }
  if (findUser(db, email) || (phone && findUser(db, phone))) {
    return res.status(409).json({ ok: false, code: 'exists' });
  }
  const pack = db.packs.find((p) => p.id === body.pack);
  const user = {
    fullname: String(body.fullname).trim(),
    country: body.country || '',
    phone,
    email,
    pack: pack ? pack.id : (body.pack || ''),
    packLabel: pack ? packLabel(pack) : (body.packLabel || ''),
    password: bcrypt.hashSync(password, 10),
    status: 'pending',
    createdAt: now(),
    balance: 0,
    pending: 0,
    tx: [],
    videos: {},
    notifs: [{
      id: uid('ntf'),
      title: 'Bienvenue',
      message: 'Votre inscription est enregistrée. Un administrateur activera votre compte.',
      at: now(),
      read: false,
      from: 'system'
    }]
  };
  db.users.push(user);
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { type: 'member', email: user.email, name: user.fullname, at: now() };
  save(db);
  setCookie(res, token);
  res.json({ ok: true, user: publicUser(user), token });
});

app.post('/api/login', (req, res) => {
  const db = load();
  const user = findUser(db, req.body && req.body.login);
  if (!user) return res.json({ ok: false, code: 'notfound' });
  if (!bcrypt.compareSync(String((req.body && req.body.password) || ''), user.password)) {
    return res.json({ ok: false, code: 'badpass' });
  }
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { type: 'member', email: user.email, name: user.fullname, at: now() };
  save(db);
  setCookie(res, token);
  const pub = publicUser(user);
  if (user.status === 'suspended' || user.status === 'banned') {
    return res.json({ ok: false, code: 'suspended', user: pub });
  }
  if (user.status !== 'active') return res.json({ ok: false, code: 'pending', user: pub, token });
  res.json({ ok: true, user: pub, token });
});

app.post('/api/admin/login', (req, res) => {
  const db = load();
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  const admin = db.admins.find((a) => a.email.toLowerCase() === email);
  const rec = { at: now(), email, ok: false, ua: String(req.headers['user-agent'] || '').slice(0, 120) };
  if (!admin || !bcrypt.compareSync(password, admin.password)) {
    db.logins.unshift(rec);
    db.logins = db.logins.slice(0, 200);
    save(db);
    return res.json({ ok: false });
  }
  rec.ok = true;
  rec.name = admin.name;
  db.logins.unshift(rec);
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { type: 'admin', email: admin.email, name: admin.name, at: now() };
  log(db, admin.name, 'Connexion administrateur', admin.email, 'Session ouverte');
  save(db);
  setCookie(res, token);
  res.json({ ok: true, admin: { name: admin.name, email: admin.email } });
});

app.post('/api/logout', (req, res) => {
  const db = load();
  const token = req.cookies[COOKIE];
  if (token && db.sessions[token]) {
    const s = db.sessions[token];
    if (s.type === 'admin') log(db, s.name, 'Déconnexion', s.email, 'Session fermée');
    delete db.sessions[token];
    save(db);
  }
  res.clearCookie(COOKIE, { path: '/' });
  res.json({ ok: true });
});

app.post('/api/video-action', (req, res) => {
  const db = load();
  const user = requireUser(req, res, db);
  if (!user) return;
  ensureWallet(user);
  const { videoId, action, amount, title } = req.body || {};
  const allowed = { like: true, seen: true, fav: true };
  if (!allowed[action] || !videoId) return res.json({ ok: false, code: 'badact' });
  if (!user.videos[videoId]) {
    user.videos[videoId] = { like: false, seen: false, fav: false, credited: false, watchSec: 0 };
  }
  const st = user.videos[videoId];
  if (st.credited) return res.json({ ok: true, locked: true, creditedNow: false, state: st, user: publicUser(user) });
  st[action] = true;
  if (action === 'like') {
    const vid = db.videos.find((v) => v.id === videoId);
    if (vid) {
      vid.stats = vid.stats || { views: 0, likes: 0, credits: 0 };
      vid.stats.likes += 1;
    }
  }
  save(db);
  res.json({ ok: true, locked: !!st.credited, creditedNow: false, state: st, user: publicUser(user) });
});

function applyVideoCredit(db, user, videoId, meta) {
  ensureWallet(user);
  if (!user.videos[videoId]) {
    user.videos[videoId] = { like: false, seen: false, fav: false, credited: false, watchSec: 0 };
  }
  const st = user.videos[videoId];
  if (st.credited) return { creditedNow: false, state: st };
  const vid = (db.videos || []).find((v) => v.id === videoId);
  const minWatch = Math.min(30, Math.max(5, Number((meta && meta.minWatch) || (vid && vid.minWatch) || 5)));
  if ((st.watchSec || 0) < minWatch) return { creditedNow: false, state: st };
  const value = Number((meta && meta.amount) != null ? meta.amount : (vid && vid.reward));
  const title = (meta && meta.title) || (vid && vid.title) || videoId;
  const txId = 'tx-vid-' + videoId;
  const already = (user.tx || []).some((t) => t.id === txId);
  st.credited = true;
  st.seen = true;
  st.amount = Number.isFinite(value) ? value : 0;
  let creditedNow = false;
  if (!already && st.amount > 0) {
    user.balance += st.amount;
    user.tx.unshift({
      id: txId, type: 'credit', label: 'Gain vidéo · ' + title,
      amount: st.amount, videoId: videoId, status: 'done', at: now()
    });
    creditedNow = true;
    if (vid) {
      vid.stats = vid.stats || { views: 0, likes: 0, credits: 0 };
      vid.stats.credits += 1;
    }
  }
  return { creditedNow: creditedNow, state: st };
}

app.post('/api/video-credit', (req, res) => {
  const db = load();
  const user = requireUser(req, res, db);
  if (!user) return;
  const { videoId, amount, title, minWatch, watchSec } = req.body || {};
  if (!videoId) return res.json({ ok: false, code: 'badact' });
  ensureWallet(user);
  if (!user.videos[videoId]) {
    user.videos[videoId] = { like: false, seen: false, fav: false, credited: false, watchSec: 0 };
  }
  if (watchSec != null) {
    user.videos[videoId].watchSec = Math.max(user.videos[videoId].watchSec || 0, Number(watchSec) || 0);
  }
  const credit = applyVideoCredit(db, user, videoId, { amount, title, minWatch });
  save(db);
  res.json({
    ok: true,
    locked: !!credit.state.credited,
    creditedNow: credit.creditedNow,
    state: credit.state,
    user: publicUser(user)
  });
});

app.post('/api/watch', (req, res) => {
  const db = load();
  const user = requireUser(req, res, db);
  if (!user) return;
  ensureWallet(user);
  const { videoId, sec, absolute, amount, title, minWatch } = req.body || {};
  if (!videoId) return res.json({ ok: false });
  if (!user.videos[videoId]) {
    user.videos[videoId] = { like: false, seen: false, fav: false, credited: false, watchSec: 0 };
  }
  if (absolute) user.videos[videoId].watchSec = Math.max(user.videos[videoId].watchSec || 0, Number(sec) || 0);
  else user.videos[videoId].watchSec = (user.videos[videoId].watchSec || 0) + (Number(sec) || 0);
  const credit = applyVideoCredit(db, user, videoId, { amount, title, minWatch });
  save(db);
  res.json({
    ok: true,
    locked: !!credit.state.credited,
    creditedNow: credit.creditedNow,
    state: credit.state,
    user: publicUser(user)
  });
});

app.post('/api/view', (req, res) => {
  const db = load();
  const user = requireUser(req, res, db);
  if (!user) return;
  const vid = db.videos.find((v) => v.id === (req.body && req.body.videoId));
  if (vid) {
    vid.stats = vid.stats || { views: 0, likes: 0, credits: 0 };
    vid.stats.views += 1;
    save(db);
  }
  res.json({ ok: true });
});

app.post('/api/withdraw', (req, res) => {
  const db = load();
  const user = requireUser(req, res, db);
  if (!user) return;
  ensureWallet(user);
  const value = Number(req.body && req.body.amount);
  const method = String((req.body && req.body.method) || '');
  const phone = String((req.body && req.body.phone) || '');
  const custom = Number(user.minWithdraw);
  const dbMin = Number(db.settings && db.settings.minWithdraw);
  const minWd = (Number.isFinite(custom) && custom > 0)
    ? custom
    : (Number.isFinite(dbMin) && dbMin > 0 ? dbMin : MIN_WITHDRAW);
  if (!Number.isFinite(value) || value < minWd) return res.json({ ok: false, code: 'min', min: minWd });
  if (value > user.balance) return res.json({ ok: false, code: 'funds' });
  user.balance -= value;
  user.pending += value;
  user.tx.unshift({
    id: uid('tx'),
    type: 'withdraw',
    label: 'Retrait · ' + method,
    amount: value,
    phone,
    method,
    status: 'pending',
    at: now()
  });
  save(db);
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/notifs/read', (req, res) => {
  const db = load();
  const user = requireUser(req, res, db);
  if (!user) return;
  ensureWallet(user);
  const id = req.body && req.body.id;
  const n = user.notifs.find((x) => x.id === id);
  if (n) n.read = true;
  save(db);
  res.json({ ok: true });
});

app.get('/api/admin/state', (req, res) => {
  const db = load();
  if (!requireAdmin(req, res, db)) return;
  deliverScheduled(db);
  save(db);
  res.json({
    ok: true,
    users: db.users.map(publicUser),
    packs: db.packs,
    videos: db.videos,
    notifications: db.notifications,
    testimonials: db.testimonials,
    settings: db.settings,
    activity: db.activity,
    logins: db.logins
  });
});

app.post('/api/admin/users/status', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  const user = db.users.find((u) => u.email === req.body.email);
  if (!user) return res.json({ ok: false });
  user.status = req.body.status;
  if (user.status === 'active') user.activatedAt = now();
  log(db, admin.name, 'Statut membre', user.email, user.status);
  if (user.status === 'active') {
    ensureWallet(user);
    user.notifs.unshift({
      id: uid('ntf'), title: 'Compte activé',
      message: 'Votre compte a été activé. Vous pouvez accéder au catalogue.',
      at: now(), read: false, from: 'admin'
    });
  }
  save(db);
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/admin/users/update', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  const user = db.users.find((u) => u.email === req.body.email);
  if (!user) return res.json({ ok: false });
  const patch = req.body.patch || {};
  ['fullname', 'phone', 'country', 'pack', 'packLabel', 'status', 'minWithdraw'].forEach((k) => {
    if (patch[k] !== undefined) user[k] = patch[k];
  });
  if (patch.minWithdraw === null || patch.minWithdraw === '') user.minWithdraw = null;
  if (patch.password) user.password = bcrypt.hashSync(String(patch.password), 10);
  if (patch.pack && !patch.packLabel) {
    const p = db.packs.find((x) => x.id === patch.pack);
    if (p) user.packLabel = packLabel(p);
  }
  log(db, admin.name, 'Modification membre', user.email, user.fullname + ' · ' + user.status);
  save(db);
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/admin/users/delete', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  db.users = db.users.filter((u) => u.email !== req.body.email);
  log(db, admin.name, 'Suppression membre', req.body.email, '');
  save(db);
  res.json({ ok: true });
});

app.post('/api/admin/users/credit', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  const user = db.users.find((u) => u.email === req.body.email);
  if (!user) return res.json({ ok: false });
  ensureWallet(user);
  const value = Number(req.body.amount);
  if (!Number.isFinite(value) || value === 0) return res.json({ ok: true, user: publicUser(user) });
  user.balance += value;
  user.tx.unshift({
    id: uid('tx'),
    type: value > 0 ? 'credit' : 'debit',
    label: req.body.label || 'Ajustement administrateur',
    amount: Math.abs(value),
    status: 'done',
    at: now()
  });
  log(db, admin.name, 'Ajout de récompense', user.email, value + ' FCFA');
  save(db);
  res.json({ ok: true, user: publicUser(user) });
});

app.post('/api/admin/withdraw', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  const { email, txId, status, message } = req.body || {};
  if (!String(message || '').trim()) return res.json({ ok: false, code: 'message' });
  const user = db.users.find((u) => u.email === email);
  if (!user) return res.json({ ok: false, code: 'nouser' });
  ensureWallet(user);
  const tx = user.tx.find((t) => t.id === txId && t.type === 'withdraw');
  if (!tx) return res.json({ ok: false, code: 'notx' });
  if (tx.status === 'paid' || tx.status === 'rejected') return res.json({ ok: false, code: 'final' });
  tx.adminMessage = message;
  tx.resolvedAt = now();
  if (status === 'rejected') {
    user.balance += tx.amount;
    user.pending = Math.max(0, user.pending - tx.amount);
    tx.status = 'rejected';
  } else if (status === 'approved') tx.status = 'approved';
  else if (status === 'paid') {
    user.pending = Math.max(0, user.pending - tx.amount);
    tx.status = 'paid';
  } else return res.json({ ok: false, code: 'badst' });
  user.notifs.unshift({
    id: 'ntf-wd-' + txId,
    title: status === 'rejected' ? 'Retrait refusé' : 'Retrait validé',
    message,
    at: now(),
    read: false,
    from: 'admin',
    kind: 'withdraw'
  });
  log(db, admin.name, 'Gestion retrait', email, status + ' · ' + message);
  save(db);
  res.json({ ok: true, user: publicUser(user), tx });
});

app.post('/api/admin/packs', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  const item = Object.assign({ id: req.body.id || uid('pack'), active: true }, req.body);
  const i = db.packs.findIndex((p) => p.id === item.id);
  if (i >= 0) db.packs[i] = Object.assign({}, db.packs[i], item);
  else db.packs.push(item);
  log(db, admin.name, i >= 0 ? 'Modification pack' : 'Ajout pack', item.id, (item.range || '') + ' · ' + item.name);
  save(db);
  res.json({ ok: true, pack: item, packs: db.packs });
});

app.post('/api/admin/packs/toggle', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  const p = db.packs.find((x) => x.id === req.body.id);
  if (p) {
    p.active = !p.active;
    log(db, admin.name, p.active ? 'Activation pack' : 'Désactivation pack', p.id, p.name);
    save(db);
  }
  res.json({ ok: true, packs: db.packs });
});

app.post('/api/admin/packs/delete', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  db.packs = db.packs.filter((p) => p.id !== req.body.id);
  log(db, admin.name, 'Suppression pack', req.body.id, '');
  save(db);
  res.json({ ok: true, packs: db.packs });
});

app.post('/api/admin/videos', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  const item = Object.assign({
    id: req.body.id || uid('vid'),
    active: true,
    minWatch: 5,
    reward: 8000,
    stats: { views: 0, likes: 0, credits: 0 },
    rows: ['all', 'films']
  }, req.body);
  item.reward = clampReward(item.reward);
  item.minWatch = Math.min(30, Math.max(5, Number(item.minWatch) || 5));
  const i = db.videos.findIndex((v) => v.id === item.id);
  if (i >= 0) db.videos[i] = Object.assign({}, db.videos[i], item);
  else db.videos.push(item);
  log(db, admin.name, i >= 0 ? 'Modification vidéo' : 'Ajout vidéo', item.id, item.title);
  save(db);
  res.json({ ok: true, videos: db.videos });
});

app.post('/api/admin/videos/toggle', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  const v = db.videos.find((x) => x.id === req.body.id);
  if (v) {
    v.active = v.active === false;
    log(db, admin.name, v.active ? 'Activation vidéo' : 'Désactivation vidéo', v.id, v.title);
    save(db);
  }
  res.json({ ok: true, videos: db.videos });
});

app.post('/api/admin/videos/delete', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  db.videos = db.videos.filter((v) => v.id !== req.body.id);
  log(db, admin.name, 'Suppression vidéo', req.body.id, '');
  save(db);
  res.json({ ok: true, videos: db.videos });
});

app.post('/api/admin/notify', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  const n = {
    id: uid('ntf'),
    to: req.body.to || 'all',
    emails: req.body.emails || [],
    title: req.body.title || 'Annonce',
    message: req.body.message || '',
    scheduledAt: req.body.scheduledAt || null,
    delivered: !req.body.scheduledAt,
    at: now()
  };
  db.notifications.unshift(n);
  if (n.delivered) pushNotifToUsers(db, n);
  log(db, admin.name, 'Notification', n.to === 'all' ? 'Tous les membres' : (n.emails || []).join(', '), n.title);
  save(db);
  res.json({ ok: true, notifications: db.notifications });
});

app.post('/api/admin/testimonials', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  const item = Object.assign({ id: req.body.id || uid('tst'), published: true }, req.body);
  const i = db.testimonials.findIndex((t) => t.id === item.id);
  if (i >= 0) db.testimonials[i] = Object.assign({}, db.testimonials[i], item);
  else db.testimonials.push(item);
  log(db, admin.name, i >= 0 ? 'Modification témoignage' : 'Ajout témoignage', item.id, item.name);
  save(db);
  res.json({ ok: true, testimonials: db.testimonials });
});

app.post('/api/admin/testimonials/delete', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  db.testimonials = db.testimonials.filter((t) => t.id !== req.body.id);
  log(db, admin.name, 'Suppression témoignage', req.body.id, '');
  save(db);
  res.json({ ok: true, testimonials: db.testimonials });
});

app.post('/api/admin/password', (req, res) => {
  const db = load();
  const sess = requireAdmin(req, res, db);
  if (!sess) return;
  const current = String((req.body && req.body.current) || '');
  const next = String((req.body && req.body.next) || '');
  const admin = db.admins.find((a) => a.email === sess.email);
  if (!admin || !bcrypt.compareSync(current, admin.password)) return res.json({ ok: false, code: 'badpass' });
  if (next.length < 6) return res.json({ ok: false, code: 'weak' });
  admin.password = bcrypt.hashSync(next, 10);
  log(db, sess.name, 'Mot de passe administrateur', admin.email, 'Modifié');
  save(db);
  res.json({ ok: true });
});

app.post('/api/admin/videos/apply-reward', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  const value = clampReward(req.body && req.body.amount);
  (db.videos || []).forEach((v) => { v.reward = value; });
  if (!db.settings) db.settings = {};
  db.settings.videoReward = value;
  log(db, admin.name, 'Gain vidéo global', 'videos', value + ' FCFA');
  save(db);
  res.json({ ok: true, reward: value, videos: db.videos });
});

app.post('/api/admin/settings', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  db.settings = Object.assign({}, db.settings, req.body || {});
  log(db, admin.name, 'Paramètres du site', 'settings', 'Mise à jour');
  save(db);
  res.json({ ok: true, settings: db.settings });
});

app.get('/api/admin/backup', (req, res) => {
  const db = load();
  if (!requireAdmin(req, res, db)) return;
  const copy = JSON.parse(JSON.stringify(db));
  copy.users.forEach((u) => { delete u.password; });
  copy.admins.forEach((a) => { delete a.password; });
  delete copy.sessions;
  log(db, sessionOf(req, db).name, 'Sauvegarde exportée', 'backup', now());
  save(db);
  res.json({ ok: true, backup: copy });
});

app.post('/api/admin/backup', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  const data = req.body && req.body.backup;
  if (!data) return res.json({ ok: false });
  if (Array.isArray(data.packs)) db.packs = data.packs;
  if (Array.isArray(data.videos)) db.videos = data.videos;
  if (Array.isArray(data.notifications)) db.notifications = data.notifications;
  if (Array.isArray(data.testimonials)) db.testimonials = data.testimonials;
  if (data.settings) db.settings = data.settings;
  log(db, admin.name, 'Sauvegarde importée', 'backup', data.at || now());
  save(db);
  res.json({ ok: true });
});

app.get('/api/admin/members', (req, res) => {
  const db = load();
  if (!requireAdmin(req, res, db)) return;
  res.json({ ok: true, members: (db.users || []).map(publicUser) });
});

app.get('/api/admin/withdrawals', (req, res) => {
  const db = load();
  if (!requireAdmin(req, res, db)) return;
  const rows = [];
  (db.users || []).forEach((u) => {
    (u.tx || []).forEach((t) => {
      if (t && t.type === 'withdraw') {
        rows.push({
          id: t.id,
          email: u.email,
          fullname: u.fullname,
          phone: t.phone || u.phone || '',
          amount: t.amount,
          method: t.method || '',
          status: t.status || 'pending',
          at: t.at,
          adminMessage: t.adminMessage || '',
          resolvedAt: t.resolvedAt || null
        });
      }
    });
  });
  rows.sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
  res.json({ ok: true, withdrawals: rows });
});

app.put('/api/admin/withdrawals/:id', (req, res) => {
  const db = load();
  const admin = requireAdmin(req, res, db);
  if (!admin) return;
  const id = req.params.id;
  const status = String((req.body && req.body.status) || '');
  const message = String((req.body && req.body.message) || '').trim();
  if (!message) return res.json({ ok: false, code: 'message' });
  let found = null;
  let owner = null;
  (db.users || []).forEach((u) => {
    const tx = (u.tx || []).find((t) => t && t.id === id && t.type === 'withdraw');
    if (tx) { found = tx; owner = u; }
  });
  if (!found || !owner) return res.json({ ok: false, code: 'notx' });
  if (found.status === 'paid' || found.status === 'rejected') return res.json({ ok: false, code: 'final' });
  found.adminMessage = message;
  found.resolvedAt = now();
  if (status === 'rejected') {
    owner.balance += found.amount;
    owner.pending = Math.max(0, (owner.pending || 0) - found.amount);
    found.status = 'rejected';
  } else if (status === 'approved') found.status = 'approved';
  else if (status === 'paid') {
    owner.pending = Math.max(0, (owner.pending || 0) - found.amount);
    found.status = 'paid';
  } else return res.json({ ok: false, code: 'badst' });
  if (!owner.notifs) owner.notifs = [];
  owner.notifs.unshift({
    id: 'ntf-wd-' + id,
    title: status === 'rejected' ? 'Retrait refusé' : 'Retrait validé',
    message,
    at: now(),
    read: false,
    from: 'admin',
    kind: 'withdraw'
  });
  log(db, admin.name, 'Gestion retrait', owner.email, status + ' · ' + message);
  save(db);
  res.json({ ok: true, user: publicUser(owner), tx: found });
});

app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ ok: false });
  next();
});

boot()
  .then(async (info) => {
    let persist = info.mode;
    if (mongo.uri()) {
      try {
        await mongo.connect();
        const db = load();
        await mongo.pullInto(db);
        dbmod.save(db);
        persist = 'mongo';
      } catch (err) {
        console.error('GTA: MongoDB indisponible → ' + info.mode + '. ' + err.message);
      }
    }
    app.listen(PORT, '0.0.0.0', () => {
      console.log('GOOGLE TV AFRIQUE prêt sur http://0.0.0.0:' + PORT + ' (' + persist + ')');
    });
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
