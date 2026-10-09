# Notre semaine – repas & courses

Planning des repas de la semaine, batch cooking, liste de courses, stock et encas, partagés entre nos téléphones.

- Site : https://sanjedesign.github.io/notre-semaine/
- Base produits : [Open Food Facts](https://fr.openfoodfacts.org) (licence ODbL) pour le scan et la recherche de produits.
- Synchronisation : Supabase (une ligne par foyer, protégée par le code secret du foyer).

## Import de recettes par lien et photos des plats

La fonction Supabase `supabase/functions/recipe-import` lit les liens de recettes (sites de recettes, YouTube, Instagram, TikTok…) et range les photos des plats ajoutés depuis l'appli.

Installation (une seule fois) : tableau de bord Supabase → Edge Functions → Deploy a new function → Via Editor → nom `recipe-import` → coller le contenu de `supabase/functions/recipe-import/index.ts` → Deploy. Aucun réglage supplémentaire : la fonction n'accepte que les foyers déjà enregistrés dans la table `planner`.

Sans cette fonction, l'ajout de recette marche quand même par texte collé, photo (lecture sur le téléphone avec Tesseract.js) ou saisie à la main.
