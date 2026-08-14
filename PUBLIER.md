# Publier GOOGLE TV AFRIQUE (un admin voit tout le monde)

Netlify ne suffit **pas** pour ça : chaque téléphone garde ses propres comptes.
Il faut **Render** (serveur) + **GitHub** (le code) + une **base Postgres** (la mémoire partagée).

## Ce que vous obtenez

- Une adresse du type `https://google-tv-afrique-xxxx.onrender.com`
- Tous les membres s’inscrivent au **même** endroit
- L’admin (`/admin.html`) voit **tous** les comptes, soldes et retraits
- Les données survivent quand le site s’endort (grâce à Postgres)

## 1. Compte GitHub

1. Ouvrez [https://github.com/signup](https://github.com/signup)
2. Créez le compte (e-mail + mot de passe)
3. Cliquez **+** en haut à droite → **New repository**
4. Nom : `google-tv-afrique`
5. Cochez **Public**
6. **Ne cochez pas** “Add a README”
7. **Create repository**

## 2. Envoyer le code dans le dépôt

### Sur ordinateur (le plus simple)

1. Téléchargez le dossier du projet (ZIP `GOOGLE-TV-AFRIQUE-RENDER.zip`)
2. Dézippez-le
3. Sur la page GitHub du dépôt vide : **uploading an existing file**
4. Glissez **tout le contenu** du dossier (le fichier `index.html` doit être à la racine, pas dans un sous-dossier)
5. Message : `Site GOOGLE TV AFRIQUE`
6. **Commit changes**

### En ligne de commande

```bash
git init
git add .
git commit -m "Site GOOGLE TV AFRIQUE avec serveur"
git branch -M main
git remote add origin https://github.com/VOTRE-COMPTE/google-tv-afrique.git
git push -u origin main
```

## 3. Render — relier GitHub

1. Ouvrez [https://dashboard.render.com](https://dashboard.render.com) (compte déjà créé)
2. En haut à droite : **+ New** → **Blueprint**
   (ou menu **Blueprints** à gauche → **New Blueprint Instance**)
3. **Connect GitHub** / Authorize si demandé
   - Autorisez Render à voir le dépôt `google-tv-afrique`
4. Choisissez le dépôt `google-tv-afrique`
5. Render lit `render.yaml` et propose :
   - Web Service `google-tv-afrique`
   - Base Postgres `google-tv-afrique-db`
6. **Apply** / **Deploy**
7. Attendez 3 à 6 minutes (Build → Live)

Si Blueprint n’apparaît pas, créez à la main :

1. **+ New** → **Web Service**
2. Connectez le dépôt
3. Réglages :
   - **Language** : Node
   - **Build command** : `npm install`
   - **Start command** : `npm start`
   - **Instance** : Free
   - **Region** : Frankfurt
4. Créez aussi **+ New → Postgres** (plan Free)
5. Dans le Web Service → **Environment** → ajoutez  
   `DATABASE_URL` = Internal Database URL de la base

## 4. Tester que l’admin voit tout le monde

URL Render : `https://google-tv-afrique-xxxx.onrender.com`

| Page | Identifiants |
|---|---|
| Accueil | l’URL Render |
| Admin `/admin.html` | `admin@googletvafr.com` / `GTA2026` |
| Démo `/connexion.html` | `demo@googletvafr.com` / `demo123` |

1. Sur un téléphone : inscrivez un **vrai** nouveau membre
2. Sur un autre navigateur : ouvrez `/admin.html` → le membre doit apparaître
3. Activez-le dans l’admin → il peut entrer dans l’espace vidéo

**C’est cette URL Render** qu’il faut partager aux membres (plus Netlify).

## Important

- Premier chargement après inactivité : **30 à 60 secondes** (plan gratuit, le site s’endort).
- La base Postgres gratuite expire au bout de **90 jours** : exportez une sauvegarde depuis l’admin avant, ou passez sur un plan payant.
- Changez le mot de passe admin dès la mise en ligne.
- WhatsApp reste `https://wa.me/2250565564257`.

## En local

```bash
npm install
npm start
```

Ouvrir http://localhost:3000
