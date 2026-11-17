import test from 'node:test';
import assert from 'node:assert/strict';
import { creerServiceQualification, creerFournisseurIA, validerDemande, lireReponseIA } from './service.server.mjs';
import { qualifierDemande } from './qualification.mjs';

// Données exclusivement fictives ; aucun transport HTTP.
const demande = { description: 'Projet fictif de cuisine', budget: '8000 EUR', delai: 'Dans 1 à 3 mois', typeTravaux: 'Cuisine', ville: 'Ville fictive' };
const contexte = { tenantId: 'entreprise-fictive-a' };
const sortie = { priorite: 'elevee', motif: 'Projet fictif à étudier', informationsManquantes: [], actionRecommandee: 'Préparer un rendez-vous', requiresHumanReview: false };
const fournisseur = (transport) => creerFournisseurIA({ nom: 'fictif', modele: 'test-v1', origine: 'simulation', transport });
const service = (transport, options = {}) => creerServiceQualification({ fournisseur: fournisseur(transport), ...options });

test('sans fournisseur : moteur de règles conservé et provenance explicite', async () => {
  const resultat = await creerServiceQualification()(demande, contexte);
  const { fournisseur: nom, repli, ...historique } = resultat;
  assert.deepEqual(historique, qualifierDemande(demande));
  assert.equal(nom, null);
  assert.equal(repli.code, 'IA_NON_CONFIGUREE');
});

test('fournisseur configurable : JSON fictif validé, simulation jamais étiquetée IA', async () => {
  let appel;
  const resultat = await service(async (args) => { appel = args; return JSON.stringify(sortie); })(demande, contexte);
  assert.equal(resultat.analysePar, 'simulation');
  assert.equal(resultat.priorite, 'elevee');
  assert.equal(resultat.motif, sortie.motif);
  assert.equal(resultat.actionRecommandee, sortie.actionRecommandee);
  assert.equal(resultat.requiresHumanReview, false);
  assert.deepEqual(resultat.informationsManquantes, []);
  assert.deepEqual(resultat.fournisseur, { nom: 'fictif', modele: 'test-v1' });
  assert.equal(resultat.repli, null);
  assert.equal(appel.modele, 'test-v1');
  assert.deepEqual(appel.demande, demande);
  assert.deepEqual(appel.contexte, contexte);
  assert.ok(appel.signal instanceof AbortSignal);
  assert.doesNotThrow(() => JSON.stringify(resultat));
});

test('entrées et contexte invalides rejetés avant tout appel fournisseur', async () => {
  let appels = 0;
  const analyser = service(() => { appels++; return sortie; });
  for (const mauvaise of [null, [], 'texte', { description: 42 }, { budget: null },
    { description: 'x'.repeat(4001) }, { ville: 'x'.repeat(201) }, { email: 'fictif' },
    JSON.parse('{"__proto__":"interdit"}')]) {
    await assert.rejects(analyser(mauvaise, contexte));
  }
  for (const mauvais of [undefined, {}, { tenantId: '' }, { tenantId: 42 }, { tenantId: 'x'.repeat(101) }]) {
    await assert.rejects(analyser(demande, mauvais), TypeError);
  }
  assert.equal(appels, 0);
  assert.deepEqual(validerDemande({ description: '  fictif  ' }), { description: 'fictif' });
});

test('validation stricte : sorties incorrectes déclenchent toutes un repli', async () => {
  const mauvaises = [null, [], 'pas du JSON', '{}', 'x'.repeat(8193),
    { ...sortie, priorite: 'urgente' }, { ...sortie, motif: '  ' },
    { ...sortie, motif: 'x'.repeat(501) }, { ...sortie, actionRecommandee: '' },
    { ...sortie, requiresHumanReview: 'false' },
    { ...sortie, requiresHumanReview: undefined },
    { ...sortie, informationsManquantes: ['email'] },
    { ...sortie, informationsManquantes: ['ville', 'ville'] },
    { ...sortie, informationsManquantes: [42] },
    { ...sortie, analysePar: 'ia' }];
  for (const mauvaise of mauvaises) {
    assert.throws(() => lireReponseIA(mauvaise));
    const resultat = await service(() => mauvaise)(demande, contexte);
    assert.equal(resultat.repli.code, 'IA_REPONSE_INVALIDE');
    assert.equal(resultat.analysePar, 'regles');
    assert.equal(resultat.requiresHumanReview, true);
    assert.equal(resultat.priorite, qualifierDemande(demande).priorite);
  }
});

test('erreurs synchrones et asynchrones : repli sans fuite du message fournisseur', async () => {
  for (const transport of [() => { throw new Error('secret-fictif'); }, async () => { throw new Error('secret-fictif'); }]) {
    const resultat = await service(transport)(demande, contexte);
    assert.equal(resultat.repli.code, 'IA_INDISPONIBLE');
    assert.equal(resultat.analysePar, 'regles');
    assert.equal(resultat.requiresHumanReview, true);
    assert.ok(!JSON.stringify(resultat).includes('secret-fictif'));
  }
});

test('délai borné même si le fournisseur ignore le signal ; résultat tardif inutilisé', async () => {
  let signal;
  let finir;
  const resultat = await service((args) => {
    signal = args.signal;
    return new Promise((resolve) => { finir = resolve; });
  }, { timeoutMs: 10 })(demande, contexte);
  assert.equal(resultat.repli.code, 'IA_DELAI_DEPASSE');
  assert.equal(resultat.analysePar, 'regles');
  assert.equal(signal.aborted, true);
  finir(sortie);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resultat.analysePar, 'regles');
});

test('un appel terminé ne déclenche pas une annulation ultérieure', async () => {
  let signal;
  await service((args) => { signal = args.signal; return sortie; }, { timeoutMs: 10 })(demande, contexte);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(signal.aborted, false);
});

test('lacunes locales et incertitude imposent une revue humaine', async () => {
  const resultat = await service(() => sortie)({}, contexte);
  assert.equal(resultat.requiresHumanReview, true);
  assert.deepEqual(new Set(resultat.informationsManquantes), new Set(['description', 'budget', 'delai', 'typeTravaux', 'ville']));
  for (const extra of [{ priorite: 'a_preciser' }, { requiresHumanReview: true }, { informationsManquantes: ['budget'] }]) {
    assert.equal((await service(() => ({ ...sortie, ...extra }))(demande, contexte)).requiresHumanReview, true);
  }
});

test('appels concurrents : copies séparées et contexte entreprise propre à chaque appel', async () => {
  const appels = [];
  const analyser = service(async ({ demande: entree, contexte: ctx }) => {
    appels.push({ entree, ctx });
    assert.equal(Object.isFrozen(entree), true);
    assert.equal(Object.isFrozen(ctx), true);
    await new Promise((resolve) => setImmediate(resolve));
    return { ...sortie, motif: ctx.tenantId + ': ' + entree.description };
  });
  const entree = { ...demande };
  const premier = analyser(entree, { ...contexte, role: 'ne-pas-transmettre' });
  entree.description = 'Autre projet fictif';
  const second = analyser(entree, { tenantId: 'entreprise-fictive-b' });
  const [a, b] = await Promise.all([premier, second]);
  assert.equal(a.motif, contexte.tenantId + ': ' + demande.description);
  assert.equal(b.motif, 'entreprise-fictive-b: Autre projet fictif');
  assert.notEqual(appels[0].entree, appels[1].entree);
  assert.deepEqual(Object.keys(appels[0].ctx), ['tenantId']);
});

test('configuration incorrecte rejetée immédiatement', () => {
  for (const timeoutMs of [0, -1, 30001, NaN, 1.5, '10']) {
    assert.throws(() => creerServiceQualification({ timeoutMs }), RangeError);
  }
  assert.throws(() => creerServiceQualification({ fournisseur: {} }), TypeError);
  assert.throws(() => creerFournisseurIA(), TypeError);
  assert.throws(() => creerFournisseurIA({ nom: 'x', modele: 'x', origine: 'regles', transport() {} }), TypeError);
});

test('refuse les listes creuses et les accesseurs sans les exécuter', async () => {
  let lectures = 0;
  const listeAvecAccesseur = [];
  Object.defineProperty(listeAvecAccesseur, '0', { get() { lectures++; return 'ville'; } });
  for (const liste of [new Array(1), listeAvecAccesseur]) {
    const resultat = await service(() => ({ ...sortie, informationsManquantes: liste }))(demande, contexte);
    assert.equal(resultat.repli.code, 'IA_REPONSE_INVALIDE');
    assert.equal(resultat.analysePar, 'regles');
  }
  const entree = { get description() { lectures++; return 'fictif'; } };
  await assert.rejects(service(() => sortie)(entree, contexte), TypeError);
  const reponse = { ...sortie, get motif() { lectures++; return 'fictif'; } };
  assert.equal((await service(() => reponse)(demande, contexte)).repli.code, 'IA_REPONSE_INVALIDE');
  assert.equal(lectures, 0);
});

test('un transport synchrone trop lent ne peut pas faire accepter son résultat', async () => {
  let signal;
  const resultat = await service((args) => {
    signal = args.signal;
    const debut = performance.now();
    while (performance.now() - debut < 20) { /* Simulation locale de blocage CPU. */ }
    return sortie;
  }, { timeoutMs: 5 })(demande, contexte);
  assert.equal(resultat.repli.code, 'IA_DELAI_DEPASSE');
  assert.equal(resultat.analysePar, 'regles');
  assert.equal(signal.aborted, true);
});

test('rejet après expiration absorbé, sans rejet de promesse non géré', async () => {
  let rejeter;
  const resultat = await service(() => new Promise((_, reject) => { rejeter = reject; }), { timeoutMs: 5 })(demande, contexte);
  rejeter(new Error('Erreur réseau fictive tardive'));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resultat.repli.code, 'IA_DELAI_DEPASSE');
});

test('erreur réseau simulée : aucun journal ni erreur sensible dans le résultat', async (t) => {
  const journaux = [];
  for (const methode of ['log', 'error', 'warn', 'info', 'debug', 'trace']) {
    t.mock.method(console, methode, (...args) => journaux.push(args));
  }
  const erreur = Object.assign(new Error('Contenu confidentiel FICTIF'), { code: 'ECONNRESET' });
  const resultat = await service(async () => { throw erreur; })(demande, contexte);
  const invalide = await service(() => JSON.stringify({ contenu: 'Contenu confidentiel FICTIF' }))(demande, contexte);
  assert.deepEqual(journaux, []);
  assert.equal(resultat.repli.code, 'IA_INDISPONIBLE');
  assert.equal(invalide.repli.code, 'IA_REPONSE_INVALIDE');
  assert.ok(!JSON.stringify([resultat, invalide]).includes('Contenu confidentiel FICTIF'));
});

test('module refusé dans un contexte navigateur même si Node est disponible', async () => {
  // Le processus enfant isole la simulation et ne contacte aucun service externe.
  const { spawnSync } = await import('node:child_process');
  const url = new URL('./service.server.mjs', import.meta.url).href;
  const code = `globalThis.window = {}; await import(${JSON.stringify(url)}).then(
    () => { process.exitCode = 1; },
    (erreur) => { if (erreur.message !== 'Module réservé au serveur Node.js') process.exitCode = 2; }
  );`;
  const resultat = spawnSync(process.execPath, ['--input-type=module', '-e', code], { encoding: 'utf8', timeout: 5000 });
  assert.equal(resultat.error, undefined);
  assert.equal(resultat.status, 0, resultat.stderr);
});
