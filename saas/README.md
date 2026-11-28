# Daxenvo SaaS — fondations J7

Application Next.js App Router / TypeScript / Tailwind CSS, distincte du site vitrine `../index.html`.

Point de départ : branche J6 au commit `625f3f497cb633dac525fec221e611c2a0a96fe1`. Développement local sur `feature/j7-saas-foundation`. Aucun commit, push, déploiement public, changement Make ou appel réel OpenAI n'est nécessaire à cette application.

## Démarrer et prévisualiser

Prérequis : Node.js 22+ (24.22.1 utilisé), npm et les fichiers J6 adjacents. Les versions directes sont figées, `package-lock.json` verrouille les dépendances transitives. Aucune police ni image distante n'est requise.

Depuis la racine du dépôt :

```bash
cd saas
npm ci --cache /tmp/daxenvo-npm-cache
npm run dev
```

Ouvrir `/fr/tableau-de-bord` sur le serveur local, port 3000. La racine redirige automatiquement vers ce tableau de bord. Aucune variable d'environnement n'est nécessaire pour explorer la démonstration.

Pour vérifier le mode production local :

```bash
npm run build
npm run start
```

La racine Turbopack et la collecte des dépendances serveur sont réglées sur le dépôt pour importer les modules J6 situés hors de `saas`. Ne pas déplacer ou copier le moteur J6 dans le navigateur. L'utilisation de deux workers borne les ressources du build.

## Architecture

```text
saas/
  src/app/
    layout.tsx                      HTML, métadonnées, thème et état local
    [locale]/layout.tsx              validation de la langue et navigation
    [locale]/[section]/page.tsx      sept sections autorisées, rendu serveur
    [locale]/actions.ts             action serveur de qualification par règles
  src/components/                   navigation, écrans, formulaires, dialogues
  src/lib/domain/                   schémas Zod, modèles, opérations et fixtures
  src/lib/demo/                     magasin observable et persistance locale
  src/lib/i18n/                     dictionnaire FR, routes et formats régionaux
  src/lib/qualification/server.ts   frontière server-only vers J6
  src/lib/supabase/                 client serveur et vérification d'appartenance
  supabase/migrations/              tables, contraintes multientreprises et RLS
  supabase/tests/                   scénario SQL d'isolation à exécuter plus tard
  tests/                           tests navigateur Playwright
```

Les composants manipulent les modèles métier validés ; le magasin applique des opérations typées sans modifier les fixtures. Les champs longs, budgets, dates, horaires, références et doublons sont contrôlés. Les limites de démonstration sont de 300 éléments par collection.

## Fonctionnalités réellement opérationnelles

| Section           | Fonctionnement actuel                                                                                                                                                                                    |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tableau de bord   | Indicateurs calculés à partir des demandes, activité sur 7/30 jours, avancement, dernières demandes et agenda.                                                                                           |
| Prospects         | Liste, recherche par nom/secteur/ville et ajout d'un exemple fictif.                                                                                                                                     |
| Demandes de devis | Création, recherche, filtre par statut, détail et changement de statut. Les budgets sont des estimations, pas du chiffre d'affaires.                                                                     |
| Qualification     | Envoi d'un exemple à une action Next.js, validation serveur, exécution du moteur de règles J6, priorité, motif, informations manquantes, action proposée et revue humaine. Résultat mémorisé localement. |
| Suivi commercial  | Création d'une tâche liée à une demande, échéance, passage terminé/à réaliser. Aucun message envoyé.                                                                                                     |
| Rendez-vous       | Création et classement par date/heure. Aucun calendrier ou service de visioconférence connecté.                                                                                                          |
| Paramètres        | Thème clair, sombre ou système, réinitialisation des exemples et état honnête des intégrations.                                                                                                          |

La navigation est fonctionnelle au clavier et responsive. Le menu mobile et les dialogues utilisent `<dialog>` (focus contenu, fermeture par Échap). Les thèmes utilisent des couleurs sémantiques, un fond clair gris bleuté et des panneaux blancs et un contraste renforcé ; les statuts ne sont pas indiqués uniquement par une couleur. Le choix du thème est mémorisé via `next-themes` et l'option système réagit aux changements de l'appareil. Un audit d'accessibilité complet reste à faire.

L'initialisation locale est explicite : les actions de mutation attendent la fin du chargement. Les données corrompues sont remplacées par les fixtures avec avertissement. Un stockage bloqué bascule en mémoire temporaire avec un message. Aucune erreur ni contenu métier n'est journalisé par le magasin.

## Données fictives et limites de la persistance

Tous les exemples initiaux sont fictifs, y compris l'« Atelier Démo », qui n'est **pas un compte authentifié**. L'interface et les formulaires le signalent. La date de référence des fixtures est le **22 novembre 2026** ; elle est fixe afin de rendre les tests reproductibles. Les budgets et indicateurs ne sont pas des résultats commerciaux réels.

Les ajouts, changements et qualifications sont conservés dans `localStorage` sous `daxenvo.demo.v1`. Le thème utilise `daxenvo.theme`. Il n'y a ni synchronisation serveur, ni partage entre appareils, ni garantie de sauvegarde. Deux onglets ne se synchronisent pas en temps réel. Toute personne utilisant ce navigateur peut lire ou modifier ces données : **ne saisir aucune donnée personnelle réelle ou confidentielle**. Cette persistance ne constitue ni une base sécurisée ni l'isolation d'un SaaS multiclient.

## Internationalisation

La langue fait partie des routes (`/fr/...`). `src/lib/i18n/dictionaries.ts` fournit la liste de langues autorisées, le dictionnaire des titres/navigation/statuts et les formats `Intl` français (EUR, Europe/Paris). Seul le français est disponible ; les autres langues renvoient 404 pour éviter de présenter une traduction inexistante.

Avant d'ajouter une langue, compléter son dictionnaire, extraire les textes détaillés encore français dans les composants/formulaires, adapter les formats et la langue HTML du layout, puis ajouter les tests de navigation/traduction. L'architecture est préparée, mais aucune interface multilingue complète n'est revendiquée à J7.

## Supabase : préparation, sans sécurité simulée

Le code de démonstration ne crée pas de session, ne se connecte pas à Supabase et ne dépend d'aucune clé. `.env.example` ne contient que des champs vides. La configuration future est exclusivement serveur : `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY`. Aucune clé `service_role` n'est utilisée.

`createSupabaseServerClient` utilise les cookies via `@supabase/ssr`. `requireCompanyAccess` :

1. valide l'identifiant d'entreprise candidat ;
2. demande à Supabase de vérifier l'utilisateur (`auth.getUser`, pas une session déclarée par le client) ;
3. vérifie son adhésion à l'entreprise ;
4. refuse l'accès si configuration/session/adhésion est manquante ou si la vérification échoue.

`listCompanyRequests` vérifie ce contexte à chaque appel et ajoute le filtre d'entreprise à sa requête. Ce point d'entrée n'est exposé à aucune route ou interface de démonstration. Il ne retourne jamais des fixtures en remplacement d'un échec d'autorisation. Le renouvellement des cookies doit être intégré à une action/route de session qui autorise leur écriture ; aucun échec d'écriture de cookie n'est masqué.

La migration `001_company_foundation.sql` prépare entreprises, adhésions, prospects, demandes, suivis et rendez-vous :

- `company_id` obligatoire sur chaque donnée métier ;
- politiques RLS et privilèges limités aux adhésions de l'utilisateur authentifié ;
- aucun accès anonyme ;
- aucune modification des entreprises ou adhésions par le client ;
- clés étrangères composites empêchant de rattacher un projet ou suivi à une autre entreprise.

**Migration non exécutée, politiques RLS non validées sur une base réelle.** Le script `supabase/tests/tenant-isolation.sql` est un scénario transactionnel futur avec deux entreprises fictives, lecture interentreprises interdite, écriture interdite, refus d'élévation de rôle et refus anonyme. Son résultat n'est pas compté dans les tests passés de J7.

Avant usage réel : provisionner un projet de développement, appliquer la migration, exécuter ce scénario avec arrêt sur erreur, générer les types de base, ajouter les tests d'isolation complets, puis développer authentification, déconnexion, récupération de session et provisionnement des entreprises/membres. Les rôles sont préparés ; les droits métier fins, invitations, facturation, journaux d'audit et gestion des utilisateurs restent à développer. Ne pas exposer un point d'entrée réel avant ces validations.

## J6 et OpenAI

Tous les fichiers J6 restent inchangés. `server-only` empêche l'import du pont J6 dans un composant client. L'action `qualifierDemonstration` valide et minimise les champs autorisés puis impose `fournisseur: null`. Elle ne lit pas `OPENAI_ENABLED` et **n'importe jamais l'adaptateur OpenAI**. Le contexte fixe de démonstration ne prouve aucune identité et n'est utilisé pour aucun accès à une base.

Cette action est accessible depuis les pages de démonstration et calcule uniquement des règles locales, sans stockage serveur. Elle ne doit pas être transformée en appel IA ou en accès aux données réelles sans authentification, autorisation et quotas. Pour la production, passer par `requireCompanyAccess`, minimiser les données, établir budgets/quotas, puis connecter le fournisseur serveur J6. Ne jamais envoyer le `tenantId` au modèle. Aucun appel commercial automatique n'est déclenché ici.

Aucun secret dans les composants, les variables publiques ou GitHub ; exclure les fichiers J6 et les secrets des ressources publiques du déploiement futur. Les textes de prospects/modèles restent non fiables et sont affichés en texte échappé, jamais via `dangerouslySetInnerHTML`.

## Vérifications

Depuis `saas` :

```bash
node --test ../j6/*.test.mjs
npm run test
npm run typecheck
npm run lint
npm run build
npm run test:e2e
```

Les tests navigateur exécutent le **build de production local** sur le port 3127, puis arrêtent leur serveur. Chromium est utilisé depuis `/usr/bin/chromium` s'il existe ; sinon installer le navigateur Playwright (`npx playwright install chromium`) ou définir `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` vers un navigateur local compatible. Aucun navigateur distant/service payant nécessaire. Les tests bloquent les requêtes navigateur externes.

Les tests vérifient notamment la navigation, les créations et la persistance, les filtres, les règles serveur, la validation humaine, le suivi, l'agenda, les trois thèmes et le changement de thème système, le clavier, le mobile et les locales refusées. Voir le bilan livré pour les résultats effectivement exécutés ; le scénario SQL reste explicitement non exécuté.

## Bilan exécuté le 22 novembre 2026

- J6 : **46 tests réussis**, aucun échec ; fichiers J6 inchangés.
- Domaine et stockage J7 : **11 tests réussis**, aucun échec.
- Chromium sur build de production : **15 tests réussis**, aucun échec, dont les cinq tests du Design System et les contrôles automatisés axe WCAG A/AA du tableau de bord et du formulaire en clair/sombre. Ce périmètre ne constitue pas une certification d'accessibilité de tout le logiciel.
- TypeScript : réussi ; ESLint : réussi sans avertissement ; build Next.js : réussi.
- Audit npm des dépendances de production installées : aucune vulnérabilité connue signalée au moment du contrôle.
- Migration Supabase et scénario SQL d'isolation : **non exécutés**, aucun projet Supabase configuré.

Les premiers contrôles ont permis de corriger le périmètre Turbopack nécessaire à J6, l'initialisation des données avant mutation, les libellés de listes déroulantes, le retour de focus des dialogues et un débordement mobile. Aucun échec connu ne reste dans les commandes de validation exécutées.

La prévisualisation de cette instance a été lancée localement sur le port 3001 (`/fr/tableau-de-bord`), le port 3000 étant occupé. Pour utiliser ce même port sur une autre instance : `npm run dev -- --port 3001`. Aucun lien public ni déploiement n'a été créé.

## Design System officiel V1.0

La référence fournie est conservée dans [la charte](../docs/BRAND_GUIDELINES.md). Les sept modules partagent la feuille de styles globale et les tokens de `src/app/tokens.css`. Le symbole de marque est provisoire. Inter variable (sous-ensemble latin, Fontsource 5.3.0) est servi localement avec sa licence OFL. Vérifier la couverture des glyphes avant d’ajouter une langue utilisant une autre écriture.

### Variantes de contraste

| Usage | Combinaison retenue | Contraste |
|---|---|---|
| Bouton principal sombre | Noir sur #6366F1 | 4,70:1 (blanc sur indigo donne 4,47:1) |
| Texte actif sombre | #BDC4FF sur #312E81 | 6,80:1 (l’accent #818CF8 donne 3,83:1) |
| Texte secondaire clair sur sélection | #536278 sur #EEF2FF | 5,55:1 (la référence #64748B donne 4,26:1) |
| Texte secondaire sombre sur surface #334155 | #A4B2C5 | 4,81:1 |
| Bouton principal clair | Blanc sur #4F46E5 | 6,29:1 |

Les contrôles utilisent une bordure renforcée, distincte des séparateurs. Les statuts combinent texte et variantes fonctionnelles adaptées aux surfaces. Le jeton violet IA est réservé. La qualification locale utilise les règles J6. Les contrôles automatiques axe couvrent les sept états initiaux dans les deux thèmes, et les tests de largeur couvrent 390, 820 et 1440 pixels. Un audit manuel avec lecteurs d’écran et des traductions réelles reste à effectuer.

## J8 · Connexion et espace entreprise

Les sept écrans sous `/fr` utilisent le stockage fictif J7. La connexion par
mot de passe se trouve sous `/connexion` et l’espace entreprise sous `/espace`.
Configurer côté serveur `SUPABASE_URL` et `SUPABASE_PUBLISHABLE_KEY` (clé
`sb_publishable_`). Les comptes et leurs adhésions doivent exister au préalable.
La première entreprise par ordre d’identifiant est active en l’absence de choix.
L’espace vérifie l’identité et relit les adhésions à chaque requête.
La déconnexion concerne la session courante.

Depuis `saas`, exécuter `npm run build`, puis `npm run test:e2e` pour la démo
et le cas sans configuration, et `npm run test:auth` pour les parcours privés.
Cette dernière commande lance le build en local et un double HTTP de Supabase
sur les ports 3128 et 3129. Le SDK SSR, les cookies, le navigateur et les
réponses Next.js sont réels. Le fournisseur Auth et les adhésions sont simulés.

### J8-3C · Historique de qualification

La migration locale `003_request_qualifications.sql` crée l’historique et une table privée destinée au condensat du secret d’écriture, à provisionner séparément. L’application et PostgreSQL communiquent en HTTPS via la session Supabase de l’utilisateur. Le serveur signe un message HMAC-SHA256 lié à l’auteur vérifié, à l’entreprise active, à la demande, à l’empreinte de ses champs et au résultat J6. Le RPC reçoit uniquement ce message et sa signature. La fonction publique utilise les droits de l’appelant. La fonction privée vérifie la signature, la durée de validité et l’adhésion sous un rôle dédié sans connexion ni contournement RLS. Un identifiant d’opération unique empêche une deuxième insertion par rejeu. Les clients authentifiés ont uniquement SELECT sur l’historique. La migration corrective `003b_qualification_writer_identity.sql` lit le champ `sub` du JWT vérifié dans les paramètres de transaction de PostgREST. Le rôle d’écriture peut ainsi identifier l’auteur sans accès au schéma Auth géré par Supabase. Les politiques RLS continuent de contrôler les adhésions.

Pour une installation autorisée, générer 32 octets aléatoires et conserver leur représentation hexadécimale (64 caractères) dans le secret serveur `QUALIFICATION_WRITER_TOKEN`. Depuis une connexion d’administration, insérer dans `daxenvo_private.qualification_writer(digest)` les 32 octets SHA-256 du **texte UTF-8 hexadécimal**. Ce condensat sert de clé HMAC et doit lui-même rester confidentiel, y compris lors du provisionnement. La table accepte une seule ligne. La rotation consiste à remplacer le condensat et le secret serveur. Une table vide désactive les écritures. Exclure des journaux les corps RPC, les paramètres SQL et les secrets. Le serveur, les administrateurs de la base et les rôles privilégiés appartiennent au périmètre de confiance. Un secret compromis doit être remplacé.

La fonction verrouille l’adhésion et la demande, compare les cinq données métier à celles analysées, puis ajoute une révision. Les données source sont comparées en mémoire SQL, seule la sortie J6 est conservée. Deux analyses acceptées produisent deux révisions. Le statut commercial reste géré séparément. La suppression autorisée de la demande supprime son historique par cascade. Tant que l’historique existe, la référence à l’auteur empêche sa suppression physique.

Sous `/api/quote-requests/{id}/qualifications`, POST avec origine identique et corps vide enregistre une qualification. GET retourne les révisions décroissantes (25 par défaut, limite 100, curseur exclusif `before`). GET sur `/latest` retourne la dernière, ou 404. Une demande modifiée pendant le calcul renvoie 409 si ses champs analysés ont changé. Les trois rôles métier peuvent qualifier une demande de leur entreprise active. Le budget SQL égal à zéro étant ambigu, il est traité comme inconnu. Une nouvelle tentative de POST réussie crée volontairement une nouvelle révision.

### J9 — Automatisation des relances

L’équipe active configure les délais (heures normales et prioritaires), le maximum d’envois par demande et la taille d’un lot par `PUT /api/followup-automation/settings` (owner ou admin). Le corps JSON contient `delay_hours`, `urgent_hours`, `max_attempts` et `batch_size`. Un maximum de zéro suspend les préparations. Avant toute configuration ou préférence explicite, aucune relance ne devient prête.

Les membres consultent `GET /api/quote-requests/{id}/followup-automation`. La réponse contient la décision courante et au plus 25 décisions historiques, de la plus récente à la plus ancienne. Pour la page suivante, passer le dernier identifiant historique dans `?before=`. Les événements sont enregistrés par POST à la même adresse avec un UUID stable `operation`, un `kind` et, si nécessaire, une `value`. Une réutilisation de l’UUID avec un contenu différent produit un conflit. Les cookies, l’origine et l’entreprise active sont contrôlés par les mêmes mécanismes que J8.

| Événement | Effet |
|---|---|
| `contact` | Date du dernier contact mise à jour au moment de la saisie |
| `delay` | Échéance repoussée au moins jusqu’à l’instant ISO fourni avec fuseau |
| `interested`, `information`, `appointment`, `human` | Suivi humain jusqu’à reprise |
| `pause`, `resume` | Suspension manuelle, reprise par owner ou admin |
| `preference` | Canal déclaré pour ce prospect (email, sms ou phone), par owner ou admin |
| `refused`, `opt_out` | Arrêt pour la demande refusée ou pour toutes les demandes du prospect opposé |

Les statuts terminaux, une qualification nécessitant une revue et les rappels J8 manuels ouverts bloquent la préparation. Un changement de prospect suspend la demande pour revue. Une reprise ne lève ni une opposition ni un refus. Les délais partent du dernier contact connu ou, à défaut, de la création de la demande. Une erreur du worker conserve le SQLSTATE et une échéance de nouvelle tentative.

**Exécution périodique.** L’ordonnanceur serveur peut lancer `psql -X -f supabase/scheduler/run-followups.sql` depuis le dossier saas, avec une connexion PostgreSQL opérateur configurée séparément. Chaque entreprise configurée reçoit une transaction et un lot borné. La migration n’active aucun ordonnanceur distant. La fréquence de déclenchement détermine le retard possible après échéance.

**Contrat des futurs fournisseurs.** En contexte privé, `prepared_followups(tenant)` fournit la demande, le prospect, le canal et l’identifiant immuable de préparation à utiliser comme clé d’idempotence. Seul un accusé de livraison vérifié par une intégration de confiance pourra être enregistré par `confirm_followup_delivery`. Cette opération conserve le passage à l’état envoyé et calcule la prochaine décision dans la même transaction. Le futur transport devra revérifier la préparation et gérer les accusés tardifs ou incertains avant activation. J9 ne connecte aucun transport.

### J10 — réservations par demande de devis

La route privée `/api/quote-requests/{id}/bookings` expose la liste par GET (curseur UUID `after`) et les commandes JSON par POST. Les adhérents de l’entreprise active peuvent consulter les disponibilités (`availability`, fenêtre future de sept jours maximum, instants ISO avec décalage et zone IANA), proposer un créneau (`propose`, UUID d’opération stable, titre, start et zone), réserver (`reserve`, ID de proposition, nom et email) et synchroniser (`sync`, ID). Owner et admin peuvent annuler, obtenir le lien Calendly de déplacement ou reprendre une réconciliation avec `cancel`, `reschedule` et `recover`. Le déplacement est effectué chez Calendly puis relu par synchronisation. Les instants retournés sont en UTC.

Calendly fait autorité pour la confirmation, les changements et l’annulation. Les états locaux sont proposed, pending, confirmed, cancelled et error. Seule une observation vérifiée crée la projection J8. Le prospect est rattaché par la demande. L’UUID de réservation sert de marqueur de corrélation. Une création incertaine conserve le créneau et déclenche une recherche lors de la synchronisation suivante. Aucune réémission automatique de la création. Après cinq erreurs, la reprise requiert un gestionnaire. Une annulation incertaine se réconcilie avant une nouvelle tentative. Les changements externes deviennent visibles à la prochaine synchronisation explicite. Aucune livraison de webhook ni tâche périodique active.

Provisionnement opérateur après installation autorisée de 005 : une entrée par entreprise dans la variable serveur BOOKING_CALENDARS_JSON, indexée par UUID d’entreprise, avec host (UUID utilisateur Calendly), eventType (UUID de type individuel), token (jeton du fournisseur propre à cette entreprise) et writer (32 octets aléatoires encodés en 64 caractères hexadécimaux minuscules). Insérer par paramètres liés company_id, binding (eventType) et writer_digest dans daxenvo_private.booking_calendar. Le condensat est SHA-256 des octets UTF-8 de la chaîne hexadécimale. Protéger également ce condensat qui sert de clé HMAC. Configurer per_minute et daily_creates selon le forfait. Rotation coordonnée côté serveur et base. Utiliser un gestionnaire de secrets. L’intégration initiale nécessite un provisionnement manuel. Le parcours OAuth autonome et le renouvellement automatique des jetons restent à développer.

Le premier adaptateur prend en charge les types individuels gratuits de 15 à 240 minutes, sans question obligatoire supplémentaire, avec Google Meet ou sans lieu. Les actions utilisent le JWT Supabase de l’utilisateur et une signature serveur par entreprise. Les rôles sont vérifiés en base. Les réservations confirmées suspendent les relances automatiques de la demande. Une annulation réévalue le suivi J9 sous ses règles existantes.

### J12-1 — Qualification simulée et contrôle des dépenses

`POST /api/quote-requests/{id}/ai-analysis` accepte uniquement un objet JSON contenant
`operation` (UUID stable pour la même tentative). Les contrôles de session, d’origine,
d’entreprise active et d’objet sont ceux des routes métier. La qualification historique J8
par règles reste disponible indépendamment de cette route.

Le mode serveur `DAXENVO_AI_MODE=simulation` utilise exclusivement le simulateur local.
Le modèle logique et les limites proviennent de la politique privée de l’entreprise.
Le simulateur reçoit la priorité déterministe et les noms des champs manquants.
Aucun texte libre, identifiant ou secret ne figure dans son message. Le schéma J6 valide
la réponse avant restitution. Aucun outil commercial n’est accessible.

La migration additive 007 démarre sans politiques de consommation. Après autorisation
d’installation, l’opérateur devra provisionner un login dédié `daxenvo_ai_runtime_j122`
NOINHERIT NOBYPASSRLS, sans privilège administratif, membre uniquement de
`daxenvo_ai_gateway`, puis configurer son URL TLS vérifiée dans
`DAXENVO_AI_DATABASE_URL` côté serveur. Le rôle de connexion ne doit avoir aucun droit
métier propre. Pour Supavisor en mode session, renseigner aussi
`DAXENVO_AI_SESSION_POOLER_HOST` avec l’hôte affiché dans **Connect → Session pooler**
et utiliser le login `daxenvo_ai_runtime_j122.<référence du projet>` sur le port 5432.
La référence est vérifiée contre `SUPABASE_URL`. Chaque transaction sélectionne le rôle privé et fixe l’acteur et
l’entreprise issus de la session vérifiée. Aucune RPC publique n’est ajoutée.
L’opérateur configure une ligne ai_project et une ai_policy par entreprise autorisée.

Une réservation sérialise le contrôle du plafond global, des limites journalières
par acteur et entreprise, des jetons et dépenses journaliers et mensuels UTC,
et des appels en cours. Les tarifs de simulation sont des micro-USD entiers par
jeton. La charge réservée couvre toute l’entrée bornée et la sortie maximale.
Les tentatives restent comptabilisées après suppression de la demande. Une mesure
fiable remplace la réservation par la consommation mesurée. Une réponse invalide
mesurée autorise une nouvelle opération dans la limite configurée. Aucun nouvel
essai automatique. Un délai dépassé, une panne ambiguë ou une interruption après
réservation conserve la charge maximale et la place de concurrence, même au
changement de période. Une future procédure opérateur devra résoudre ces cas
avec preuve de consommation. Le rejeu renvoie l’état de l’opération sans rappeler
le fournisseur. Aucun résultat simulé n’est inséré dans l’historique J8.

Avant tout fournisseur réel, il faudra qualifier le modèle, ses limites, le tarif,
la majoration prudente et le comptage de l’intégralité de l’enveloppe et de la sortie
facturable, puis vérifier la réconciliation contre son décompte effectif.
Le compteur en octets du simulateur sert uniquement au test local.
