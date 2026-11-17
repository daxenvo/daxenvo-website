# Adaptateur OpenAI Responses — connexion future

## Ce qui fonctionne et ce qui n'a pas été exécuté

`creerFournisseurOpenAI` dans `openai.server.mjs` construit un fournisseur compatible avec `creerFournisseurIA`. Il utilise le `fetch` natif de Node.js 22+, sans SDK ni dépendance. Aucun appel n'a lieu lors de l'import ou de la construction. L'activation est explicite et désactivée par défaut. Aucune route HTTP n'est ajoutée.

Le corps Responses, la lecture de sa réponse, les limites, l'annulation et le repli sont testés avec un client HTTP fictif. **Aucun appel réel à OpenAI, aucune donnée personnelle réelle et aucune dépense pendant les tests.** Une simulation reste `analysePar: "simulation"`. Avec le fetch natif et après succès de l'appel, un fournisseur activé indique `analysePar: "ia"`. Un fetch injecté est volontairement toujours étiqueté simulation ; ne pas injecter un transport réel personnalisé en attendant une provenance IA.

## Format officiel vérifié

Vérification du 17 novembre 2026 à partir du [code source officiel du SDK OpenAI](https://github.com/openai/openai-node/blob/master/src/resources/responses/responses.ts) : `Responses.create`, `ResponseCreateParamsBase`, `ResponseFormatTextJSONSchemaConfig`, `ResponseOutputMessage`, `ResponseOutputText`, `ResponseOutputRefusal` et `ResponseStatus`.

Les types officiels confirment :

- `POST https://api.openai.com/v1/responses`, avec `model`, `instructions` et `input`.
- Structured Outputs dans `text.format` : `type: "json_schema"`, `name`, `schema`, `strict: true`. Le schéma exige les cinq propriétés métier et interdit les propriétés supplémentaires.
- `max_output_tokens` borne les tokens générés, y compris les tokens de raisonnement ; `store: false` demande de ne pas conserver la réponse pour une récupération ultérieure par API.
- La réponse HTTP est une enveloppe avec `status` et `output`. Le JSON métier est dans un message `assistant` dont le contenu est de type `output_text`. `output_text` à la racine est une commodité de certains SDK et n'est pas utilisée ici.
- Un refus (`refusal`) ou un statut `incomplete`, `failed`, `cancelled`, etc. ne constitue pas une qualification exploitable. Des éléments `reasoning` peuvent précéder le message final ; ils ne sont pas exposés par l'adaptateur.

Le [guide Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) et la [référence Responses](https://developers.openai.com/api/reference/resources/responses/methods/create) restent les références à consulter avant activation. Le guide web a renvoyé HTTP 403 depuis cet environnement ; la vérification a utilisé les sources officielles accessibles du SDK, sans installer celui-ci. Aucun test de compatibilité avec un modèle réel n'est revendiqué. Le sous-ensemble JSON Schema utilisé est volontairement simple ; longueurs, doublons et cohérence restent contrôlés localement.

## Configuration serveur

| Variable | Comportement |
| --- | --- |
| `OPENAI_ENABLED` | Absente ou `false` : renvoie `null`, donc règles seules. `true` : construit l'adaptateur. Toute autre valeur est rejetée. |
| `OPENAI_API_KEY` | Obligatoire uniquement après activation ; injectée via le gestionnaire de secrets du backend. Jamais dans le dépôt, les fichiers publics ou un formulaire navigateur. |
| `OPENAI_MODEL` | Identifiant obligatoire du modèle choisi et approuvé. Aucun modèle par défaut ; vérifier son accès et sa compatibilité avec Responses et JSON Schema strict. |

L'adaptateur ignore les variables d'URL personnalisée. La destination HTTPS est fixe et les redirections sont interdites : une mauvaise configuration ne doit pas transmettre le secret ailleurs. Ne pas contourner TLS, le proxy ou les protections réseau de l'hébergeur. Les variables doivent provenir de l'environnement serveur ; jamais du corps d'une requête utilisateur. Aucune variable ni secret réel n'a été ajouté aux paramètres de l'environnement cloud.

Options de code serveur, indépendantes de la demande utilisateur :

| Option | Défaut | Plage |
| --- | --- | --- |
| `timeoutMs` | 10000 ms | 1 à 30000 ms |
| `maxResponseBytes` | 65536 octets | 1024 à 1048576 octets |
| `maxOutputTokens` | 1200 tokens | 128 à 4096 tokens |

Les valeurs sont vérifiées à la construction. Une activation avec une configuration invalide échoue immédiatement, sans requête. Ce défaut de configuration doit être traité au démarrage du backend ; il n'est pas masqué comme un succès IA.

Exemple d'assemblage **sans exécuter de demande** :

```js
import { creerFournisseurOpenAI } from './j6/openai.server.mjs';
import { creerServiceQualification } from './j6/service.server.mjs';

// Lit uniquement la configuration serveur. OPENAI_ENABLED absent => fournisseur null.
const fournisseur = creerFournisseurOpenAI({ timeoutMs: 10000 });
const analyser = creerServiceQualification({ fournisseur, timeoutMs: 12000 });
// Le futur backend pourra appeler analyser(demandeMinimisee, contexteEntrepriseVerifie)
// uniquement après authentification, autorisation et contrôle du budget.
```

Le service a un délai de 2000 ms par défaut, souvent trop court pour un modèle distant. Dans cet exemple, le délai du service (12000 ms) laisse l'adaptateur appliquer sa limite de 10000 ms. Le délai le plus court gagne. Les deux contrôles sont testés.

## Traitement et erreurs

L'adaptateur renvoie uniquement les cinq champs métier, contrôlés par `lireReponseIA`. Le service ajoute la provenance et réunit les informations manquantes locales avec celles du modèle. Le moteur historique reste inchangé.

| Événement | Résultat du service |
| --- | --- |
| Désactivé | `analysePar: "regles"`, `IA_NON_CONFIGUREE` |
| HTTP non 200 (dont 401, 403, 429 et 5xx), redirection ou erreur réseau | Règles, `IA_INDISPONIBLE`, validation humaine |
| Dépassement du délai service ou adaptateur | Règles, `IA_DELAI_DEPASSE`, validation humaine |
| Corps trop volumineux, mauvais MIME, UTF-8/JSON invalide, refus, enveloppe incomplète ou contrat métier invalide | Règles, `IA_REPONSE_INVALIDE`, validation humaine |
| Succès | Résultat validé ; lacunes ou incertitude imposent une revue humaine |

Aucun retry automatique, y compris sur 429 : pas de multiplication implicite des dépenses. Les corps d'erreur HTTP ne sont pas lus. Une qualification tronquée n'est jamais « réparée » ou acceptée. Le texte métier est limité à 8192 octets en plus de la limite sur l'enveloppe HTTP.

Le lecteur compte les octets des blocs reçus, sans dépendre du seul `Content-Length`, et annule le flux en cas de dépassement. Le délai couvre la requête et la lecture du corps. Un signal d'annulation fourni par le service ou par un appel serveur direct est propagé au fetch ; un signal déjà annulé empêche tout appel. La course avec une promesse d'annulation borne le retour même si un client fictif ignore le signal. Un résultat HTTP tardif est ignoré et son corps annulé. Le timer et les écouteurs sont retirés après l'appel.

En cas d'annulation explicite d'un appel direct, l'adaptateur rejette avec une erreur générique expurgée. Le service actuel fournit son propre signal de délai ; il ne possède pas encore de signal d'annulation lié à la déconnexion d'un client HTTP. Le futur backend devra organiser cette propagation. Une annulation locale ne garantit ni l'arrêt du calcul distant ni l'absence de facturation.

## Revue de sécurité

- Le garde Node.js est hérité du module serveur importé et testé aussi sur l'adaptateur. Ce garde n'est pas une frontière de sécurité de build : exclure `j6` des bundles et ressources publics, garder le secret dans le backend.
- Le `tenantId` n'est transmis ni dans le corps, ni dans les instructions, ni dans les en-têtes. Seuls les cinq champs métier validés sont sérialisés. Aucun historique, identifiant de conversation ou métadonnée d'entreprise n'est envoyé.
- Les instructions métier sont fixes et séparées du message utilisateur JSON. Elles interdisent de suivre les instructions des prospects, d'inventer des informations, de déduire une solvabilité et d'exécuter une action. Aucun outil n'est fourni (`tools: []`, `tool_choice: "none"`). Un appel d'outil inattendu dans la réponse est rejeté.
- Les textes restent non fiables même après validation JSON : ne jamais les exécuter ni les afficher en HTML brut. Le cloisonnement du prompt ne garantit pas l'immunité à l'injection d'instructions ou l'exactitude du modèle.
- Pas de journaux du secret, des demandes, des erreurs brutes, de l'enveloppe ou du raisonnement. Les erreurs réseau sont remplacées par des messages fixes sans `cause`. Les tests vérifient l'absence de journaux et de fuite dans les résultats.
- `store: false` n'est **pas une garantie de rétention nulle**. Les obligations contractuelles, journaux de sécurité du fournisseur, hébergeur et APM doivent être évalués séparément. Les champs libres peuvent contenir des données personnelles : minimisation/masquage requis avant tout appel réel.
- La limite d'octets borne l'accumulation de l'enveloppe par l'adaptateur, pas les allocations internes du client HTTP ou un bloc réseau déjà alloué. Les quotas, limites de concurrence et protections contre les abus doivent être appliqués en amont.

## Activer et valider ultérieurement une vraie connexion

1. Construire le backend authentifié et autoriser l'entreprise à partir de la session serveur. Ajouter limites de débit, quotas par entreprise, budget et contrôle des accès. Ne pas exposer cette fonction via une route publique non authentifiée.
2. Approuver le fournisseur, le modèle, son prix, la minimisation des données et les conditions de conservation. Choisir un modèle compatible avec le contrat vérifié ci-dessus.
3. Injecter la clé via le gestionnaire de secrets serveur, choisir `OPENAI_MODEL`, puis activer explicitement `OPENAI_ENABLED=true`. Autoriser uniquement l'accès réseau nécessaire à `api.openai.com`. Ne pas inscrire de clé dans un script, une commande partagée ou un journal.
4. Après autorisation explicite d'un test potentiellement payant, faire une seule demande métier entièrement fictive depuis le backend, avec le fetch natif et des limites basses adaptées au modèle. Vérifier le résultat, sa provenance `ia`, la validation humaine, la latence et le coût observé dans les outils fournisseur. Ne pas journaliser le corps ou les en-têtes.
5. Évaluer ensuite la qualité sur des cas fictifs, les erreurs et les politiques de reprise ; surveiller des métriques expurgées. Désactiver avec `OPENAI_ENABLED=false` en cas de problème pour revenir aux règles seules.

Les étapes 1 à 5 n'ont pas été réalisées ici. Le présent travail ne crée aucune route, clé, intégration métier, sauvegarde GitHub ou publication Cloudflare.

## Tests hors réseau

```bash
node --test j6/*.test.mjs
```

Les 20 tests existants sont conservés. Les 26 nouveaux tests utilisent uniquement des `Response` et `ReadableStream` locaux et un fetch injecté. Un garde remplace aussi le fetch global dans le processus des tests OpenAI pour faire échouer tout appel accidentel. Aucune clé réelle n'est lue par ces tests ; une chaîne d'authentification explicitement fictive sert à vérifier l'en-tête. Aucun serveur HTTP ni compte OpenAI n'est nécessaire.
