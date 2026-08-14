const bcrypt = require('bcryptjs');

function clampReward(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 8000;
  return Math.min(26000, Math.max(5000, Math.round(v)));
}

function buildVideos() {
  const POSTERS = [
    'posters/cotonou.jpg', 'posters/lions.jpg', 'posters/sahel.jpg', 'posters/lagos.jpg',
    'posters/trone.jpg', 'posters/can.jpg', 'posters/lagune.jpg', 'posters/kinshasa.jpg',
    'posters/griot.jpg', 'posters/hero.jpg'
  ];
  const CATS = ['Thriller', 'Drame', 'Comédie', 'Action', 'Romance', 'Sport', 'Documentaire', 'Historique', 'Musique', 'Aventure', 'Espionnage'];
  const DURS = ['1 h 18', '1 h 32', '1 h 41', '1 h 48', '1 h 54', '1 h 58', '2 h 05', '52 min', '1 h 12', '1 h 27'];
  const CITIES = ['Cotonou', 'Abidjan', 'Dakar', 'Lagos', 'Lomé', 'Bamako', 'Ouagadougou', 'Accra', 'Douala', 'Kinshasa', 'Libreville', 'Niamey', 'Conakry', 'Nairobi', 'Casablanca'];
  function de(city) {
    return /^[AEIOUYÉÈÊÂÎÔÛ]/i.test(city) ? "d'" + city : 'de ' + city;
  }
  const PREFIXES = [
    { make: (c) => 'Nuit ' + de(c), bucket: 'films' },
    { make: (c) => 'Secrets ' + de(c), bucket: 'films' },
    { make: (c) => c + ' Express', bucket: 'films' },
    { make: (c) => 'Horizon ' + c, bucket: 'films' },
    { make: (c) => 'Les lions ' + de(c), bucket: 'sport' },
    { make: (c) => 'Lagune ' + de(c), bucket: 'series' },
    { make: (c) => 'Code ' + c, bucket: 'films' },
    { make: (c) => 'Pluie sur ' + c, bucket: 'films' },
    { make: (c) => 'Étoiles ' + de(c), bucket: 'series' },
    { make: (c) => 'Chroniques ' + de(c), bucket: 'series' }
  ];
  const FLAGSHIP = {
    v001: { title: 'Nuit de Cotonou', img: 'posters/cotonou.jpg', cat: 'Thriller', year: '2025', dur: '1 h 58', desc: 'Une enquête nocturne dans les rues mouillées de Cotonou.' },
    v002: { title: "Les Lions d'Abidjan", img: 'posters/lions.jpg', cat: 'Sport', year: '2026', dur: '1 h 46', desc: 'Un attaquant doit ramener le trophée à Abidjan.' },
    v003: { title: 'Sahel', img: 'posters/sahel.jpg', cat: 'Aventure', year: '2024', dur: '2 h 12', desc: 'Traversée épique des dunes.' },
    v004: { title: 'Mama Lagos', img: 'posters/lagos.jpg', cat: 'Comédie', year: '2025', dur: '1 h 41', desc: 'Une commerçante de Lagos transforme un quiproquo en affaire.' },
    v005: { title: "Le Trône d'Or", img: 'posters/trone.jpg', cat: 'Historique', year: '2025', dur: '8 ép.', desc: 'Une reine doit choisir entre le sang et la couronne.' },
    v006: { title: 'CAN, le souffle', img: 'posters/can.jpg', cat: 'Sport', year: '2026', dur: '52 min', desc: 'Documentaire d’une Coupe d’Afrique.' },
    v007: { title: 'Lagune', img: 'posters/lagune.jpg', cat: 'Romance', year: '2024', dur: '1 h 49', desc: 'Deux destins se croisent sur une jetée.' },
    v008: { title: 'Kinshasa Express', img: 'posters/kinshasa.jpg', cat: 'Action', year: '2025', dur: '1 h 54', desc: 'Course-poursuite à moto à Kinshasa.' },
    v009: { title: 'La Voix du Griot', img: 'posters/griot.jpg', cat: 'Drame', year: '2023', dur: '6 ép.', desc: 'Un maître de la kora transmet sa mémoire.' },
    v010: { title: 'Code Dakar', img: 'posters/hero.jpg', cat: 'Espionnage', year: '2025', dur: '1 h 44', desc: 'Une agente doit livrer une clé avant l’aube.' }
  };
  const items = [];
  let n = 0;
  PREFIXES.forEach((prefix) => {
    CITIES.forEach((city) => {
      n += 1;
      const id = 'v' + String(n).padStart(3, '0');
      const cat = CATS[(n - 1) % CATS.length];
      const rows = ['all'];
      if (n <= 18 || n % 12 === 0) rows.push('tendances');
      if (prefix.bucket === 'films' || cat === 'Action' || cat === 'Thriller') rows.push('films');
      if (prefix.bucket === 'series') rows.push('series');
      if (prefix.bucket === 'sport' || cat === 'Sport') rows.push('sport');
      const base = {
        id,
        title: prefix.make(city),
        year: String(2020 + ((n - 1) % 7)),
        dur: DURS[(n - 1) % DURS.length],
        cat,
        rows,
        img: POSTERS[(n - 1) % POSTERS.length],
        desc: 'Un récit tourné entre ' + city + ' et le reste du continent.',
        reward: clampReward(5000 + Math.floor(Math.random() * 21001)),
        minWatch: 5,
        active: true,
        stats: { views: 0, likes: 0, credits: 0 }
      };
      items.push(Object.assign(base, FLAGSHIP[id] || {}));
    });
  });
  return items;
}

function initialDb() {
  return {
    users: [{
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
    }],
    admins: [{
      id: 'adm-root',
      name: 'Super Admin',
      email: 'admin@googletvafr.com',
      password: bcrypt.hashSync('GTA2026', 10),
      createdAt: '2026-01-01T00:00:00.000Z'
    }],
    packs: [
      { id: 'std1', range: 'STANDARD', name: 'Niveau 1', price: 5200, active: true },
      { id: 'std2', range: 'STANDARD', name: 'Niveau 2', price: 12200, active: true },
      { id: 'std3', range: 'STANDARD', name: 'Niveau 3', price: 15200, active: true },
      { id: 'std4', range: 'STANDARD', name: 'Niveau 4', price: 22000, active: true },
      { id: 'std5', range: 'STANDARD', name: 'Niveau 5', price: 30000, active: true },
      { id: 'prm1', range: 'PREMIUM', name: 'VIP 1', price: 40700, active: true },
      { id: 'prm2', range: 'PREMIUM', name: 'VIP 2', price: 50700, active: true },
      { id: 'prm3', range: 'PREMIUM', name: 'VIP 3', price: 70700, active: true },
      { id: 'prm4', range: 'PREMIUM', name: 'VIP 4', price: 80700, active: true },
      { id: 'prmmax', range: 'PREMIUM', name: 'VIP Max', price: 100000, active: true },
      { id: 'gld1', range: 'GOLD', name: 'G-VIP 1', price: 200000, active: true },
      { id: 'gld2', range: 'GOLD', name: 'G-VIP 2', price: 400000, active: true },
      { id: 'gld3', range: 'GOLD', name: 'G-VIP 3', price: 800000, active: true },
      { id: 'gld4', range: 'GOLD', name: 'G-VIP 4', price: 1000000, active: true }
    ],
    videos: buildVideos(),
    notifications: [],
    testimonials: [
      { id: 't1', name: 'Awa K.', city: 'Abidjan', text: 'Activation rapide et catalogue riche. Je recommande.', published: true },
      { id: 't2', name: 'Jean-Marc D.', city: 'Cotonou', text: 'Le support WhatsApp répond vraiment. Pack Premium validé le jour même.', published: true }
    ],
    settings: {
      name: 'GOOGLE TV AFRIQUE',
      logo: '',
      color: '#ea4335',
      color2: '#c5221f',
      whatsapp: '2250565564257',
      phone: '+225 05 65 56 42 57',
      email: 'support@googletvafr.com',
      facebook: '',
      instagram: '',
      tiktok: '',
      minWithdraw: 350000,
      videoReward: 8000,
      minWatch: 5,
      terms: 'En utilisant la plateforme, vous acceptez les règles d’activation, de visionnage et de retrait définies par l’administrateur.',
      privacy: 'Les données des membres sont stockées pour le fonctionnement du service et ne sont pas revendues.'
    },
    activity: [],
    logins: [],
    sessions: {}
  };
}

module.exports = { initialDb, clampReward, buildVideos };
