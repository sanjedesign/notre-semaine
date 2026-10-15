# Notre semaine – repas & courses

Planning des repas de la semaine, batch cooking, liste de courses, stock et encas, partagés entre nos téléphones.

- Site : https://sanjedesign.github.io/notre-semaine/
- Base produits : [Open Food Facts](https://fr.openfoodfacts.org) (licence ODbL) pour le scan et la recherche de produits.
- Synchronisation : Supabase (une ligne par foyer, protégée par le code secret du foyer).

## Import de recettes par lien et photos des plats

La fonction Supabase `supabase/functions/recipe-import` lit les liens de recettes (sites de recettes, YouTube, Instagram, TikTok…) et range les photos des plats ajoutés depuis l'appli.

Installation (une seule fois) : tableau de bord Supabase → Edge Functions → Deploy a new function → Via Editor → nom `recipe-import` → coller le contenu de `supabase/functions/recipe-import/index.ts` → Deploy. Aucun réglage supplémentaire : la fonction n'accepte que les foyers déjà enregistrés dans la table `planner`.

Sans cette fonction, l'ajout de recette marche quand même par texte collé, photo (lecture sur le téléphone avec Tesseract.js) ou saisie à la main.

## Analyse des plateaux de cantine en photo

L'action `meal` de la même fonction estime les aliments, portions et nutriments d'un plateau en photo. Elle a besoin d'une clé d'IA, ajoutée dans Supabase → Edge Functions → Secrets :
- `GEMINI_API_KEY` : clé gratuite créée sur https://aistudio.google.com/apikey (modèle utilisé : `gemini-flash-latest`, réglable avec le secret `GEMINI_MODEL`) ;
- ou `ANTHROPIC_API_KEY` (modèle réglable avec `ANTHROPIC_MODEL`).

Sans clé, le plateau se compose à la main à partir d'une liste de plats de cantine.

## Recettes à découvrir (bouton « Actualiser »)

Deux fois par jour, le workflow `.github/workflows/discover.yml` lance `scripts/discover.mjs` : il lit les plans de site de HelloFresh, Jow et Marmiton, ouvre des fiches au hasard et garde les recettes saines et riches en protéines d'après les valeurs nutritionnelles publiées par le site (plats de 280 à 680 kcal avec au moins 24 g de protéines, encas de 50 à 300 kcal avec au moins 7 g de protéines). Elles sont rangées par pages de 10, variées (viandes, poissons, œufs, végé et 2 encas), dans la branche `data` (`discover/index.json`, `discover/p/N.json`). L'appli lit la page suivante à chaque « Actualiser » ; les recettes ajoutées, écartées ou passées ne reviennent jamais. Seuls le titre, la photo, le lien, les ingrédients et les valeurs nutritionnelles sont repris ; les étapes restent sur le site d'origine.

Lancer une collecte à la main : onglet Actions → « Recettes à découvrir » → Run workflow.

## Sport et pas

- Chaque téléphone choisit son profil (« À qui est ce téléphone ? », ou Réglages → Ce téléphone) : Suivi et Sport s'ouvrent dessus. Ce réglage reste sur l'appareil.
- Onglet Sport, en trois blocs : Pas (objectif, 7 derniers jours), Séance (séance du jour, toutes les séances haltères / tapis de course / tapis de sol, lecteur avec séries, repos chronométré, bips, voix et animation de chaque mouvement) et Stats (semaine en cours, 8 dernières semaines, poids, charges, records). Les séances et les pas sont synchronisés avec le foyer.
- Les animations des exercices sont dessinées par l'appli (silhouette animée), sans image ni vidéo externe ; « Comment faire » propose aussi une recherche de vidéos YouTube.
- Pas automatiques sur iPhone : Sport → Pas automatiques. Sano crée une ligne privée dans la table `planner` (une par personne) ; un raccourci Apple (« Sano pas ») y écrit le total du jour par une requête PATCH, et l'appli le relit. Aucune modification de Supabase n'est nécessaire.
