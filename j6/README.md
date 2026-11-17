# Daxenvo AI — J6 : interface de qualification serveur

## Statut réel

Le moteur `qualification.mjs` reste un **moteur de règles locales**, inchangé : ce n'est pas une IA. Une interface serveur Node.js permet désormais de lui adjoindre un fournisseur IA. Un adaptateur HTTP OpenAI Responses est disponible, désactivé par défaut. Aucun modèle réel n'a été contacté ; aucun SDK, secret ni dépendance supplémentaire n'est inclus. Les tests utilisent uniquement des données et réponses fictives.

Ce dossier n'est relié ni à `index.html`, ni à Cloudflare, Tally, Make, Google Sheets ou à la démonstration Sites. Aucun envoi réel ni stockage n'a été effectué pendant le développement et les tests. L'adaptateur OpenAI pourra envoyer une demande après activation explicite côté serveur. Le module serveur est une fonction à importer dans un futur backend, **pas une route HTTP ni un SaaS multiclient opérationnel**. Node.js 22 ou plus récent est recommandé (tests exécutés avec Node.js 24).

## Fichiers

- `qualification.mjs` : règles historiques et validateur historique minimal ; inchangé.
- `qualification.test.mjs` : cinq tests historiques ; inchangé.
- `service.server.mjs` : validation stricte, adaptateur fournisseur configurable, délai maximal et repli.
- `service.server.test.mjs` : quinze tests supplémentaires sans réseau.
- `openai.server.mjs` : adaptateur HTTP OpenAI Responses, activable uniquement par configuration serveur.
- `openai.server.test.mjs` : 26 tests supplémentaires avec HTTP fictif.
- [OPENAI.md](./OPENAI.md) : contrat officiel vérifié, configuration, activation ultérieure et revue de sécurité.

## Tester

Depuis la racine du dépôt :

```bash
node --test j6/qualification.test.mjs
node --test j6/*.test.mjs
```

La suite complète couvre 46 tests : règles, simulation, entrées invalides, contrat de sortie, erreurs synchrones/asynchrones, délai dépassé, nettoyage du délai, revue humaine, requêtes concurrentes et configuration. Les réponses invalides sont testées dans plusieurs variantes. Ces contrôles ne mesurent pas la qualité d'un véritable modèle.

## Usage côté serveur, sans IA connectée

```js
import { creerServiceQualification } from './j6/service.server.mjs';

const analyser = creerServiceQualification();
const resultat = await analyser({
  description: 'Exemple fictif de rénovation de cuisine',
  typeTravaux: 'Cuisine', ville: 'Ville fictive',
  budget: '8000 EUR', delai: 'Dans 1 à 3 mois'
}, { tenantId: 'entreprise-fictive' });
// resultat.analysePar === 'regles'
// resultat.repli.code === 'IA_NON_CONFIGUREE'
```

`tenantId` doit provenir du contexte d'authentification **vérifié par le backend**, jamais directement du corps envoyé par un navigateur. Le module vérifie sa présence et son format, pas les droits d'accès. Il ne garde ni état par entreprise ni cache ni historique. Chaque appel reçoit sa propre copie immuable des champs autorisés. Les tests de concurrence vérifient cette séparation locale ; ils ne prouvent pas l'isolation d'une base de données ou d'un service distant.

## Fournisseur configurable et simulation

```js
import { creerFournisseurIA, creerServiceQualification } from './j6/service.server.mjs';

const fournisseur = creerFournisseurIA({
  nom: 'fictif', modele: 'simulation-v1', origine: 'simulation',
  transport: async ({ modele, demande, contexte, signal }) => ({
    priorite: 'moyenne',
    motif: 'Réponse fictive pour tester le contrat',
    informationsManquantes: [],
    actionRecommandee: 'Préparer un rendez-vous',
    requiresHumanReview: false
  })
});
const analyser = creerServiceQualification({ fournisseur, timeoutMs: 2000 });
// await analyser(demandeFictive, contexteEntrepriseVerifie)
// analysePar === 'simulation', jamais 'ia' pour ce transport fictif.
```

L'adaptateur attend `transport({ modele, demande, contexte, signal })`, retournant une promesse, un objet JSON métier ou du texte JSON. Le contexte entreprise est réservé au routage et à l'autorisation **côté serveur** : ne pas le transmettre aveuglément au modèle. L'adaptateur OpenAI réalise ce travail (voir [OPENAI.md](./OPENAI.md)) mais n'a été testé qu'avec HTTP fictif. `origine: 'ia'` est réservé à cet adaptateur réellement connecté ; le module ne peut pas vérifier la nature du transport injecté. Aucun appel n'a lieu à la création du fournisseur.

## Contrat JSON

Entrée : objet contenant uniquement `description` (maximum 4000 caractères), `budget`, `delai`, `typeTravaux`, `ville` (maximum 200 caractères chacun). Les champs fournis doivent être des chaînes. Les espaces de bord sont retirés. Les champs absents ou vides restent acceptés pour permettre une qualification « à préciser » et une revue humaine ; les autres types, champs inconnus et dépassements sont rejetés avant tout appel. Ne pas fournir d'identité, d'email ou de téléphone ; un texte libre peut néanmoins contenir des données personnelles et nécessitera une minimisation supplémentaire avant intégration réelle.

Réponse attendue du transport : exactement ces cinq propriétés (pas de bloc Markdown) :

```json
{
  "priorite": "moyenne",
  "motif": "Justification de la priorité proposée",
  "informationsManquantes": ["budget"],
  "actionRecommandee": "Clarifier le budget",
  "requiresHumanReview": true
}
```

- `priorite` : `elevee`, `moyenne`, `faible` ou `a_preciser`.
- `motif` est la justification ; `motif` et `actionRecommandee` : chaînes non vides, 500 caractères maximum.
- `informationsManquantes` : liste sans doublon contenant uniquement des noms des cinq champs d'entrée.
- `requiresHumanReview` : booléen obligatoire.

Le texte JSON est limité à 8192 octets. Une propriété supplémentaire, une réponse tronquée, un JSON incorrect ou un champ invalide provoque un repli. Le service ajoute lui-même la provenance : `version`, `analysePar` (`regles`, `simulation` ou `ia`), `fournisseur` (nom et modèle, ou `null`), `repli` (code ou `null`). En repli, les champs historiques, dont `signaux`, sont conservés. La réponse du modèle ne peut pas s'attribuer sa propre provenance.

Les lacunes détectées par les règles sont réunies avec celles du modèle : le modèle ne peut pas les effacer. Toute lacune, priorité `a_preciser` ou demande explicite de revue impose `requiresHumanReview: true`. Une sortie conforme ne garantit pas une analyse correcte ; la priorité IA peut différer des règles et doit encore être évaluée sur des exemples métier.

## Erreurs et repli

Les entrées et configurations invalides lèvent `TypeError` ou `RangeError` : le futur backend devra les convertir en erreurs HTTP adaptées, sans exposer de détails sensibles.

Les échecs du fournisseur renvoient une qualification par règles avec un code stable, sans message d'erreur brut ni copie de la réponse invalide :

| Code | Comportement |
| --- | --- |
| `IA_NON_CONFIGUREE` | Règles seules ; indicateur de revue historique conservé. |
| `IA_INDISPONIBLE` | Erreur du transport, y compris réseau ou quota ; revue humaine imposée. |
| `IA_DELAI_DEPASSE` | Délai dépassé ; signal d'annulation émis, règles et revue humaine. |
| `IA_REPONSE_INVALIDE` | JSON ou contrat invalide ; règles et revue humaine. |

`timeoutMs` est un entier entre 1 et 30000 (défaut 2000). Le résultat tardif d'un fournisseur est ignoré. Le transport doit respecter `signal` pour interrompre réellement le travail distant : le repli ne garantit pas l'annulation de sa facturation. Il n'y a aucun retry automatique. La réponse brute n'est ni journalisée ni conservée par ce module.

## Travail restant avant connexion réelle et SaaS multiclient

1. Choisir un modèle OpenAI compatible Responses et Structured Outputs, approuver le budget et fournir la configuration serveur sécurisée. L'adaptateur HTTP est écrit et testé fictivement ; sa compatibilité avec le modèle et le compte choisis reste à vérifier par un test réel autorisé. Aucun secret ne doit être placé dans le navigateur ou le dépôt.
2. Définir les instructions métier, traiter les descriptions comme des données non fiables (injection d'instructions possible), comparer la qualité sur des cas fictifs et organiser la validation humaine. Aucune action commerciale automatique n'est déclenchée ici.
3. Construire le backend authentifié : autorisation par entreprise, isolation du stockage, quotas et limites de débit/coût, limites du corps HTTP entrant. L'adaptateur OpenAI borne maintenant la réponse réseau avant lecture complète ; cela ne remplace pas les quotas par entreprise.
4. Minimiser ou masquer les données personnelles, choisir les conditions de traitement du fournisseur, la rétention, les journaux expurgés et les procédures de suppression. Aucun traitement réel n'a été testé.
5. Tester l'intégration réelle autorisée (latence, erreurs réseau, quotas, coûts, qualité et isolation) avant tout déploiement. Le fournisseur absent permet déjà de développer et tester localement sans dépense.

J4 et la démonstration Sites restent des composants distincts. Aucune connexion API réelle ni préparation de publication n'est réalisée par ce changement.

## Revue technique et sécurité J6

Corrections vérifiées par des tests de régression :

- Les listes creuses (par exemple `new Array(1)`) étaient ignorées par `Array.every` ; leurs éléments sont désormais validés individuellement. Les accesseurs sur les entrées, le contexte et les réponses sont refusés, sans exécuter leurs getters. Cette protection vise les objets JavaScript fournis par un adaptateur ; le JSON brut ne contient pas d'accesseurs. Un adaptateur reste du code serveur de confiance, pas un bac à sable pour du JavaScript hostile ou des Proxy.
- Un transport synchrone bloquant pouvait empêcher le timer de s'exécuter et livrer un résultat tardif. Une mesure monotone du temps écoulé refuse désormais ce résultat. Le code synchrone n'est pas interrompu : les futurs transports doivent rester asynchrones. Une isolation en processus distinct serait nécessaire pour interrompre du calcul hostile.
- Un garde explicite refuse les contextes navigateur et les environnements sans Node.js. Seuls les champs de configuration utiles sont capturés par le service. Le suffixe `.server.mjs` seul ne constitue pas une protection.

Contrôles confirmés : JSON invalide, provenance falsifiée, erreur réseau simulée, expiration, rejet tardif, champs manquants, validation humaine et absence de journaux `console` sur les chemins d'erreur. Les cinq tests historiques restent inchangés. Les simulations ne nécessitent aucun service, secret, dépendance tierce ou appel externe.

Le module n'expose aucune route et ne contient aucune clé API. Le garde Node.js limite les erreurs d'import, mais ne remplace pas une séparation client/serveur au niveau du futur build. Exclure `j6` des ressources publiques et des bundles navigateur ; injecter les secrets uniquement dans le backend et ne jamais les sérialiser dans les réponses. Le serveur statique de développement ne doit jamais héberger des fichiers contenant des secrets.

Le service marque toujours le repli `analysePar: "regles"`, avec `fournisseur: null` et un code `repli` ; une réponse modèle ne peut pas injecter ces champs. Un futur affichage doit respecter cette provenance, et échapper les textes du modèle (ne pas utiliser de HTML brut). Le module ne peut pas empêcher une interface externe d'afficher un libellé trompeur.

La surveillance des journaux testée porte sur le module actuel : le futur adaptateur HTTP, l'hébergeur, l'APM et le fournisseur peuvent avoir leurs propres journaux à configurer. La présence de `tenantId` ne constitue toujours pas une authentification. La qualité du modèle, l'injection de prompt, l'autorisation multiclient, les quotas, la minimisation des données et l'annulation réellement respectée par une API restent des validations préalables à toute mise en production.
