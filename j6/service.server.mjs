/** Interface Node.js uniquement. Aucun client réseau ni secret embarqué. */
import { setTimeout, clearTimeout } from 'node:timers';
import { qualifierDemande } from './qualification.mjs';

if (typeof window !== 'undefined' || typeof process === 'undefined' || process.release?.name !== 'node') {
  throw new Error('Module réservé au serveur Node.js');
}

const CHAMPS = Object.freeze({ description: 4000, budget: 200, delai: 200, typeTravaux: 200, ville: 200 });
const PRIORITES = ['elevee', 'moyenne', 'faible', 'a_preciser'];
const SORTIE = ['priorite', 'motif', 'informationsManquantes', 'actionRecommandee', 'requiresHumanReview'];
const objet = (x) => x !== null && typeof x === 'object' && !Array.isArray(x)
  && [Object.prototype, null].includes(Object.getPrototypeOf(x));
// Refuser les accesseurs : leur lecture pourrait changer après validation ou exécuter du code.
const donnees = (x) => objet(x) && Reflect.ownKeys(x).every((key) => {
  const descripteur = Object.getOwnPropertyDescriptor(x, key);
  return typeof key === 'string' && descripteur.enumerable && Object.hasOwn(descripteur, 'value');
});
const texte = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max;

/** Entrée JSON stricte et copie indépendante ; les champs absents restent qualifiables par les règles. */
export function validerDemande(demande) {
  if (!donnees(demande)) throw new TypeError('Demande JSON attendue');
  if (Object.keys(demande).some((key) => !Object.hasOwn(CHAMPS, key))) {
    throw new TypeError('Champ de demande non autorisé');
  }
  const copie = {};
  for (const [key, max] of Object.entries(CHAMPS)) {
    if (!Object.hasOwn(demande, key)) continue;
    if (typeof demande[key] !== 'string') throw new TypeError(`Le champ ${key} doit être une chaîne`);
    if (demande[key].length > max) throw new RangeError(`Le champ ${key} dépasse ${max} caractères`);
    copie[key] = demande[key].trim();
  }
  return Object.freeze(copie);
}

/** Contrat IA strict, distinct du validateur historique minimal. Aucun champ de provenance accepté du modèle. */
export function lireReponseIA(brut) {
  if (typeof brut === 'string' && Buffer.byteLength(brut, 'utf8') > 8192) {
    throw new TypeError('Réponse IA trop volumineuse');
  }
  const valeur = typeof brut === 'string' ? JSON.parse(brut) : brut;
  if (!donnees(valeur) || Object.keys(valeur).length !== SORTIE.length
      || !SORTIE.every((key) => Object.hasOwn(valeur, key))
      || !PRIORITES.includes(valeur.priorite)
      || !texte(valeur.motif, 500) || !texte(valeur.actionRecommandee, 500)
      || typeof valeur.requiresHumanReview !== 'boolean'
      || !Array.isArray(valeur.informationsManquantes)
      || valeur.informationsManquantes.length > 5) {
    throw new TypeError('Réponse IA hors contrat');
  }
  const manquantes = [];
  for (let i = 0; i < valeur.informationsManquantes.length; i++) {
    const propriete = Object.getOwnPropertyDescriptor(valeur.informationsManquantes, String(i));
    const key = propriete?.value;
    if (!propriete || !Object.hasOwn(propriete, 'value') || typeof key !== 'string'
        || !Object.hasOwn(CHAMPS, key) || manquantes.includes(key)) {
      throw new TypeError('Liste des informations manquantes invalide');
    }
    manquantes.push(key);
  }
  return {
    priorite: valeur.priorite,
    motif: valeur.motif.trim(),
    actionRecommandee: valeur.actionRecommandee.trim(),
    informationsManquantes: manquantes,
    requiresHumanReview: valeur.requiresHumanReview
  };
}

/**
 * Adaptateur configurable. transport({ modele, demande, contexte, signal }) renvoie
 * le JSON métier (objet ou texte), pas une enveloppe spécifique à un vendeur.
 * Aucun transport réseau fourni. Ne jamais sélectionner 'ia' pour un faux transport.
 */
export function creerFournisseurIA({ nom, modele, origine, transport } = {}) {
  if (!texte(nom, 100) || !texte(modele, 100) || !['simulation', 'ia'].includes(origine)
      || typeof transport !== 'function') throw new TypeError('Configuration fournisseur invalide');
  return Object.freeze({
    nom, modele, origine,
    analyser: ({ demande, contexte, signal }) => transport({ modele, demande, contexte, signal })
  });
}

/**
 * À appeler depuis un backend après authentification et autorisation du tenant.
 * Aucun historique, cache, stockage ou identifiant d'entreprise global.
 */
export function creerServiceQualification({ fournisseur = null, timeoutMs = 2000 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 30000) {
    throw new RangeError('timeoutMs doit être compris entre 1 et 30000');
  }
  if (fournisseur !== null && (!objet(fournisseur) || !texte(fournisseur.nom, 100)
      || !texte(fournisseur.modele, 100) || !['simulation', 'ia'].includes(fournisseur.origine)
      || typeof fournisseur.analyser !== 'function')) throw new TypeError('Fournisseur invalide');
  // Capture la configuration ; aucune donnée de requête ne reste dans cette fermeture.
  const config = fournisseur === null ? null : Object.freeze({
    nom: fournisseur.nom, modele: fournisseur.modele, origine: fournisseur.origine, analyser: fournisseur.analyser
  });
  return async function analyser(demande, contexte) {
    if (!donnees(contexte) || !texte(contexte.tenantId, 100)) {
      throw new TypeError('Contexte entreprise authentifié requis');
    }
    const contexteSur = Object.freeze({ tenantId: contexte.tenantId.trim() });
    const entree = validerDemande(demande);
    const secours = qualifierDemande(entree);
    const repli = (code) => ({
      ...secours,
      // Un échec fournisseur nécessite une vérification, même si le dossier est complet.
      requiresHumanReview: code !== 'IA_NON_CONFIGUREE' || secours.requiresHumanReview,
      fournisseur: null, repli: { code }
    });
    if (config === null) return repli('IA_NON_CONFIGUREE');

    const debut = performance.now();
    const controleur = new AbortController();
    let minuterie;
    try {
      const expiration = new Promise((_, reject) => {
        minuterie = setTimeout(() => {
          reject(new Error('Expiration'));
          controleur.abort();
        }, timeoutMs);
      });
      let brut;
      try {
        brut = await Promise.race([
          Promise.resolve().then(() => config.analyser({
            demande: entree, contexte: contexteSur, signal: controleur.signal
          })),
          expiration
        ]);
      } catch {
        return repli(controleur.signal.aborted ? 'IA_DELAI_DEPASSE' : 'IA_INDISPONIBLE');
      }
      // Un transport synchrone peut bloquer la boucle et empêcher le timer de s'exécuter.
      if (performance.now() - debut >= timeoutMs) {
        controleur.abort();
        return repli('IA_DELAI_DEPASSE');
      }
      let resultat;
      try { resultat = lireReponseIA(brut); }
      catch { return repli('IA_REPONSE_INVALIDE'); }
      // Le modèle ne peut pas effacer les lacunes déjà détectées localement.
      const manquantes = [...new Set([...secours.informationsManquantes, ...resultat.informationsManquantes])];
      return {
        ...resultat, informationsManquantes: manquantes,
        requiresHumanReview: resultat.requiresHumanReview || manquantes.length > 0 || resultat.priorite === 'a_preciser',
        version: 'j6-service-v1', analysePar: config.origine,
        fournisseur: { nom: config.nom, modele: config.modele }, repli: null
      };
    } finally {
      clearTimeout(minuterie);
    }
  };
}
