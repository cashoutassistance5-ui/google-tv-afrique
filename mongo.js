const bcrypt = require('bcryptjs');

let mongoose = null;
let User = null;
let Admin = null;
let Session = null;
let ready = false;
let pushTimer = null;

function enabled() {
  return ready && !!User;
}

function uri() {
  return process.env.MONGODB_URI || process.env.MONGO_URL || '';
}

async function connect() {
  const url = uri();
  if (!url) return { ok: false, mode: 'off' };
  mongoose = require('mongoose');
  mongoose.set('strictQuery', true);
  await mongoose.connect(url, {
    serverSelectionTimeoutMS: 15000
  });

  const userSchema = new mongoose.Schema({
    fullname: String,
    country: String,
    phone: String,
    email: { type: String, unique: true, index: true },
    pack: String,
    packLabel: String,
    password: String,
    status: { type: String, default: 'pending' },
    createdAt: String,
    activatedAt: String,
    balance: { type: Number, default: 0 },
    pending: { type: Number, default: 0 },
    minWithdraw: Number,
    tx: { type: Array, default: [] },
    videos: { type: Object, default: {} },
    notifs: { type: Array, default: [] }
  }, { minimize: false });

  const adminSchema = new mongoose.Schema({
    id: String,
    name: String,
    email: { type: String, unique: true },
    password: String,
    createdAt: String
  });

  const sessionSchema = new mongoose.Schema({
    token: { type: String, unique: true, index: true },
    type: String,
    email: String,
    name: String,
    at: String
  });

  User = mongoose.models.GtaUser || mongoose.model('GtaUser', userSchema);
  Admin = mongoose.models.GtaAdmin || mongoose.model('GtaAdmin', adminSchema);
  Session = mongoose.models.GtaSession || mongoose.model('GtaSession', sessionSchema);

  await seedIfEmpty();
  ready = true;
  console.log('GTA: MongoDB Atlas connecté');
  return { ok: true, mode: 'mongo' };
}

async function seedIfEmpty() {
  const n = await User.countDocuments();
  if (!n) {
    await User.create({
      fullname: 'Membre Démo',
      country: 'CI',
      phone: '+2250500000000',
      email: 'demo@googletvafr.com',
      pack: 'prm1',
      packLabel: 'PREMIUM - VIP 1 (40 700 FCFA)',
      password: bcrypt.hashSync('demo123', 10),
      status: 'active',
      createdAt: '2026-01-01T00:00:00.000Z',
      balance: 125000,
      pending: 0,
      tx: [{
        id: 'tx-welcome',
        type: 'credit',
        label: 'Bonus de bienvenue',
        amount: 125000,
        status: 'done',
        at: '2026-01-01T00:00:00.000Z'
      }],
      videos: {},
      notifs: []
    });
  }
  const a = await Admin.countDocuments();
  if (!a) {
    await Admin.create({
      id: 'adm-root',
      name: 'Super Admin',
      email: 'admin@googletvafr.com',
      password: bcrypt.hashSync('GTA2026', 10),
      createdAt: '2026-01-01T00:00:00.000Z'
    });
  }
}

function clean(doc) {
  if (!doc) return null;
  const o = typeof doc.toObject === 'function' ? doc.toObject() : Object.assign({}, doc);
  delete o._id;
  delete o.__v;
  return o;
}

async function pullInto(db) {
  if (!enabled()) return db;
  const users = await User.find().lean();
  const admins = await Admin.find().lean();
  const sessions = await Session.find().lean();
  if (users.length) db.users = users.map(clean);
  if (admins.length) db.admins = admins.map(clean);
  if (sessions.length) {
    db.sessions = db.sessions || {};
    sessions.forEach((s) => {
      db.sessions[s.token] = { type: s.type, email: s.email, name: s.name, at: s.at };
    });
  }
  return db;
}

async function pushFrom(db) {
  if (!enabled() || !db) return;
  const users = Array.isArray(db.users) ? db.users : [];
  const admins = Array.isArray(db.admins) ? db.admins : [];
  const sessions = db.sessions || {};

  const ops = users.map((u) => ({
    updateOne: {
      filter: { email: u.email },
      update: { $set: u },
      upsert: true
    }
  }));
  if (ops.length) await User.bulkWrite(ops, { ordered: false });

  const aops = admins.map((a) => ({
    updateOne: {
      filter: { email: a.email },
      update: { $set: a },
      upsert: true
    }
  }));
  if (aops.length) await Admin.bulkWrite(aops, { ordered: false });

  const tokens = Object.keys(sessions);
  if (tokens.length) {
    await Session.bulkWrite(tokens.map((token) => ({
      updateOne: {
        filter: { token },
        update: { $set: Object.assign({ token }, sessions[token]) },
        upsert: true
      }
    })), { ordered: false });
  }
}

function schedulePush(db) {
  if (!enabled()) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    pushFrom(db).catch((err) => console.error('GTA Mongo persist:', err.message));
  }, 200);
}

module.exports = {
  connect,
  enabled,
  uri,
  pullInto,
  pushFrom,
  schedulePush
};
