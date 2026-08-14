# GOOGLE TV AFRIQUE — projet complet

Site de streaming + espace membre + administration.
Les données sont partagées grâce au serveur (`server.js` + `data/db.json`).

## Lancer en local

```bash
npm install
npm start
```

Ouvrir : http://localhost:3000

| Rôle | Adresse | Identifiants |
|---|---|---|
| Accueil | `/` | — |
| Admin | `/admin.html` | `admin@googletvafr.com` / `GTA2026` |
| Membre démo | `/connexion.html` | `demo@googletvafr.com` / `demo123` |

## Arborescence

```
google-tv-afrique/
├── index.html              Accueil public
├── inscription.html        Création de compte
├── connexion.html          Connexion membre
├── espace.html             Catalogue vidéo (membres activés)
├── solde.html              Portefeuille
├── retrait.html            Demandes de retrait
├── profil.html             Profil + notifications
├── admin.html              Tableau de bord administrateur
│
├── css/
│   ├── admin.css           Styles de l’admin
│   └── bottom-nav.css      Barre du bas (Vidéo / Solde / Retrait / Profil)
│
├── js/
│   ├── auth.js             Comptes (mode local si pas de serveur)
│   ├── admin-store.js      Packs, vidéos, réglages (mode local)
│   ├── cloud.js            Branche le site sur l’API dès que le serveur tourne
│   ├── admin-app.js        Interface admin
│   ├── catalog.js          Génération des 150 vidéos
│   ├── espace-app.js       Catalogue, gains, lecteur
│   ├── brand.js            Nom, couleurs, WhatsApp, packs dynamiques
│   └── nav.js              Navigation basse
│
├── posters/                Affiches des films
├── server.js               Serveur Express + API
├── server/db.js            Lecture / écriture de la base
├── server/seed.js          Données de départ (admin, démo, packs, 150 vidéos)
├── data/db.json            Base réelle (créée au premier lancement)
│
├── package.json            Dépendances Node
├── render.yaml             Config Render
├── PUBLIER.md              Guide de mise en ligne
└── README.md               Ce fichier
```

## Pages et rôle

1. **Public** : accueil, packs, témoignages, inscription, connexion.
2. **Membre activé** : catalogue 150 vidéos, gain crédité automatiquement après le temps de lecture, solde, retrait (min. 350 000 FCFA), profil.
3. **Admin** : membres, packs, vidéos, récompenses, retraits (message obligatoire), notifications, témoignages, paramètres, journal, sauvegarde.

## Publication

Voir `PUBLIER.md` et `COMMENT-RENDER.html`.

- **Netlify** = vitrine statique (chaque téléphone a ses propres comptes).
- **Render** = vrai site : un admin voit tous les membres (serveur + Postgres).
