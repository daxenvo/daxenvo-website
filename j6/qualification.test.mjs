import test from 'node:test';
import assert from 'node:assert/strict';
import { qualifierDemande, validerSortieIA } from './qualification.mjs';

const demande = (delai) => ({
  description: 'Rénovation de cuisine avec contraintes de plomberie',
  budget: 'Entre 5 000 et 10 000 €',
  delai,
  typeTravaux: 'Cuisine',
  ville: 'Nantes'
});

test('classe les quatre catégories métier', () => {
  assert.equal(qualifierDemande(demande('Dès que possible')).priorite, 'elevee');
  assert.equal(qualifierDemande(demande("Dans moins d'un mois")).priorite, 'elevee');
  assert.equal(qualifierDemande(demande('Dans 1 à 3 mois')).priorite, 'moyenne');
  assert.equal(qualifierDemande(demande('Dans 3 à 6 mois')).priorite, 'moyenne');
  assert.equal(qualifierDemande(demande('Dans plus de 6 mois')).priorite, 'faible');
  assert.equal(qualifierDemande(demande('Je ne sais pas encore')).priorite, 'a_preciser');
});

test('délai absent et description absente sont signalés pour validation humaine', () => {
  const resultat = qualifierDemande({ description: '' });
  assert.equal(resultat.priorite, 'a_preciser');
  assert.equal(resultat.requiresHumanReview, true);
  assert.ok(resultat.informationsManquantes.includes('description'));
  assert.ok(resultat.informationsManquantes.includes('delai'));
});

test('demande urgente avec informations complètes ne nécessite pas de revue systématique', () => {
  const resultat = qualifierDemande(demande('Dès que possible'));
  assert.equal(resultat.requiresHumanReview, false);
  assert.equal(resultat.analysePar, 'regles');
});

test('rejette les entrées structurellement invalides', () => {
  assert.throws(() => qualifierDemande(null), TypeError);
  assert.throws(() => qualifierDemande({ description: 'x'.repeat(4001) }), RangeError);
});

test('valide le contrat minimal d’une future sortie IA', () => {
  const bonne = qualifierDemande(demande('Dans 1 à 3 mois'));
  assert.equal(validerSortieIA(bonne), true);
  assert.equal(validerSortieIA({ priorite: 'inconnue' }), false);
  assert.equal(validerSortieIA(null), false);
});
