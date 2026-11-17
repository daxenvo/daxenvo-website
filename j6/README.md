# Daxenvo AI — J6 : moteur de qualification

## Statut

**Fondation technique sans modèle IA et sans dépense API.**

Ce dossier n'est relié ni à la page publique Cloudflare, ni à Tally, ni à Make, ni à Google Sheets, ni à la démonstration Sites. Il ne déclenche aucun envoi et ne traite aucune donnée de client réel.

## Tester

Avec Node.js récent :

```bash
node --test j6/qualification.test.mjs
```

## Utiliser

```js
import { qualifierDemande } from './j6/qualification.mjs';

const resultat = qualifierDemande({
  description: 'Rénovation d’une salle de bain',
  typeTravaux: 'Salle de bain',
  ville: 'Nantes',
  budget: 'Entre 5 000 et 10 000 €',
  delai: 'Dans 1 à 3 mois'
});
console.log(resultat);
```

Le résultat contient : `priorite`, `motif`, `actionRecommandee`, `informationsManquantes`, `signaux`, `analysePar`, `requiresHumanReview` et `version`.

## Ce qui existe déjà

- J4 : Tally → Make → Google Sheets ; classification selon le délai ; rappels internes Gmail.
- Démonstration ChatGPT Sites : prototype visuel distinct, non intégré ici.
- Site public du dépôt : simple landing page, préservée intégralement.

## À faire pour achever J6

1. Définir l'interface d'un **fournisseur IA côté serveur**, avec entrée et sortie structurées.
2. Comparer les résultats IA à des exemples métier fictifs et conserver une possibilité de revue humaine.
3. Protéger les données personnelles : authentification, isolation par entreprise, minimisation et durée de conservation.
4. Tester erreurs réseau, latence, JSON incorrect, coûts et retours de secours.
5. Après approbation du budget et du fournisseur, connecter une API au serveur **sans exposer sa clé dans le navigateur**.

**Ne jamais annoncer une analyse par IA lorsque le système utilise uniquement les règles locales.**
