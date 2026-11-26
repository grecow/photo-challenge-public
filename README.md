# Défi Photo

Jeu web mobile de défis photo en équipes de deux. Un organisateur prépare jusqu’à dix photos modèles, partage le QR code de la partie, puis lance les manches chronométrées. Les joueurs reproduisent chaque photo, envoient leur dernière prise, votent et découvrent le podium.

## Développement

Le projet utilise Vinext/React, Cloudflare D1 pour l’état des parties et R2 pour les images.

```powershell
npm install
npm run db:generate
npm run dev
```

L’accès caméra nécessite HTTPS sur téléphone. Le serveur local fonctionne aussi sur `localhost` pour les essais sur ordinateur.

## Compilation et hébergement

```sh
npm ci
npm run build
```

La configuration fournie utilise les ressources D1 et R2 locales pour le développement. Pour héberger votre propre instance, configurez vos propres ressources et secrets ; aucune donnée de partie ni configuration de production ne figure dans ce dépôt.
