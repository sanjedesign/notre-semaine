#!/usr/bin/env python3
"""Traduit en français les recettes publiées en anglais (titre, ingrédients, étapes).

Utilisé par scripts/discover.mjs : une recette JSON par ligne sur l'entrée standard,
une réponse JSON par ligne sur la sortie standard.
  entrée : {"id": "...", "title": "...", "ing": ["..."], "steps": ["..."], "cat": "..."}
  sortie : {"id": "...", "title": "...", "ing": [...], "steps": [...], "cat": "...", "engine": "gemini" | "argos"}

Moteurs, dans l'ordre :
  - Gemini, si le secret GEMINI_API_KEY est défini ;
  - GitHub Models, si GH_MODELS=1 (modèle de langage fourni par GitHub, jeton GITHUB_TOKEN de l'action) ;
  - Argos Translate (hors ligne) seulement si TRANSLATE_FALLBACK=argos : sa traduction est moins naturelle,
    elle n'est donc pas utilisée par défaut (la recette est relue au passage suivant).
Les quantités américaines et anglaises (cups, oz, lb, °F) sont converties en unités métriques.
"""
import json
import os
import re
import sys
import time
import urllib.request

GEMINI_KEY = os.environ.get("GEMINI_API_KEY", "").strip()
GEMINI_MODELS = [m for m in [os.environ.get("GEMINI_MODEL", ""), "gemini-2.5-flash", "gemini-2.5-flash-lite", "gemini-flash-latest"] if m]
GH_TOKEN = os.environ.get("GITHUB_TOKEN", "").strip() if os.environ.get("GH_MODELS", "0") == "1" else ""
GH_MODELS = [m for m in [os.environ.get("GH_MODEL", ""), "openai/gpt-4.1-mini", "openai/gpt-4o-mini"] if m]
GH_STATE = {"off": False, "last": 0.0}

# ---------------------------------------------------------------- Argos (chargé à la demande)
_ARGOS = None


def argos():
    global _ARGOS
    if _ARGOS is None:
        try:
            import argostranslate.package
            import argostranslate.translate
            inst = [l.code for l in argostranslate.translate.get_installed_languages()]
            if "en" not in inst or "fr" not in inst:
                argostranslate.package.update_package_index()
                pk = [p for p in argostranslate.package.get_available_packages() if p.from_code == "en" and p.to_code == "fr"][0]
                argostranslate.package.install_from_path(pk.download())
            langs = argostranslate.translate.get_installed_languages()
            en = [l for l in langs if l.code == "en"][0]
            fr = [l for l in langs if l.code == "fr"][0]
            _ARGOS = en.get_translation(fr)
        except Exception as e:  # pas de moteur : la recette est ignorée
            print("argos indisponible : " + repr(e), file=sys.stderr)
            _ARGOS = False
    return _ARGOS


def mt(text):
    text = (text or "").strip()
    if not text:
        return ""
    T = argos()
    if not T:
        raise RuntimeError("pas de moteur de traduction")
    return T.translate(text)


# ---------------------------------------------------------------- nombres et unités
FRAC = {"½": " 1/2", "¼": " 1/4", "¾": " 3/4", "⅓": " 1/3", "⅔": " 2/3", "⅛": " 1/8", "⅕": " 1/5", "⁄": "/"}


def unfrac(s):
    for a, b in FRAC.items():
        s = s.replace(a, b)
    return s


NUM = r"(?:\d+\s+\d+/\d+|\d+/\d+|\d+(?:[.,]\d+)?)"


def tonum(s):
    s = s.strip().replace(",", ".")
    m = re.match(r"^(\d+)\s+(\d+)/(\d+)$", s)
    if m:
        return int(m.group(1)) + int(m.group(2)) / int(m.group(3))
    m = re.match(r"^(\d+)/(\d+)$", s)
    if m:
        return int(m.group(1)) / int(m.group(2))
    try:
        return float(s)
    except ValueError:
        return None


def fmtq(v):
    if v is None:
        return ""
    if abs(v - round(v)) < 0.01:
        return str(int(round(v)))
    for d, t in ((0.5, "1/2"), (0.25, "1/4"), (0.75, "3/4"), (1 / 3, "1/3"), (2 / 3, "2/3")):
        if abs(v - d) < 0.02:
            return t
    if v < 10:
        return ("%.1f" % v).rstrip("0").rstrip(".").replace(".", ",")
    return str(int(round(v)))


def r5(v):
    return int(round(v / 5.0) * 5) if v >= 20 else int(round(v))


# unité anglaise → (unité française, facteur) ; None = convertie en grammes/ml selon l'aliment
UNITS = [
    (r"kg|kilos?|kilograms?|kilogrammes?", ("g", 1000)),
    (r"g|gr|grams?|grammes?|gms?", ("g", 1)),
    (r"ml|millilit(?:re|er)s?|mls", ("ml", 1)),
    (r"cl", ("cl", 1)),
    (r"l|lit(?:re|er)s?|ltrs?", ("ml", 1000)),
    (r"fl\.?\s?oz|fluid ounces?", ("ml", 29.6)),
    (r"tbsps?|tbs|tbl|tablespoons?|tbsp\.", ("cs", 1)),
    (r"tsps?|teaspoons?|tsp\.", ("cc", 1)),
    (r"cups?|c\.", ("cup", 1)),
    (r"oz|ounces?", ("g", 28.35)),
    (r"lbs?|pounds?", ("g", 453.6)),
    (r"pints?", ("ml", 568)),
    (r"pinch(?:es)?", ("pincée", 1)),
    (r"handfuls?", ("poignée", 1)),
    (r"cloves?", ("gousse", 1)),
    (r"cans?|tins?", ("boîte", 1)),
    (r"slices?|rashers?", ("tranche", 1)),
    (r"(?:small |large )?bunch(?:es)?", ("bouquet", 1)),
    (r"sprigs?", ("brin", 1)),
    (r"knobs?", ("noix", 1)),
    (r"sticks?|stalks?", ("branche", 1)),
    (r"heads?", ("tête", 1)),
    (r"sheets?", ("feuille", 1)),
    (r"packs?|packets?|bags?|pots?|tubs?|jars?|cartons?|pouch(?:es)?", ("paquet", 1)),
    (r"pieces?|chunks?", ("morceau", 1)),
    (r"dash(?:es)?|splash(?:es)?|drizzles?", ("trait", 1)),
    (r"scoops?", ("dose", 1)),
    (r"fillets?", ("filet", 1)),
    (r"leaves|leaf", ("feuille", 1)),
]
UNIT_RE = re.compile(r"^(" + "|".join(u for u, _ in UNITS) + r")(?=[\s.,)]|$)\s*\.?\s*(?:of\s+)?", re.I)
# densités (g par cup) pour convertir les cups en grammes
CUP_G = [
    (r"flour", 125), (r"sugar|caster", 200), (r"brown sugar", 220), (r"icing sugar|powdered sugar", 120),
    (r"rice", 185), (r"oats|oatmeal", 90), (r"quinoa", 170), (r"lentils", 190), (r"couscous", 180),
    (r"cheese", 100), (r"parmesan", 90), (r"butter", 227), (r"nuts|almonds|cashews|walnuts|pecans|peanuts", 140),
    (r"breadcrumbs|panko", 60), (r"spinach|kale|rocket|arugula|lettuce|greens", 30), (r"berries|blueberries|raspberries|strawberries", 150),
    (r"beans|chickpeas", 170), (r"peas|corn|sweetcorn", 150), (r"chocolate chips", 170), (r"yogurt|yoghurt", 245),
    (r"cottage cheese|ricotta", 225), (r"onion|pepper|carrot|celery|mushrooms|tomatoes|zucchini|courgette|broccoli|cauliflower", 130),
    (r"chicken|turkey|beef|meat", 140), (r"pasta|macaroni|noodles", 100), (r"cocoa", 85), (r"honey|maple syrup|syrup", 340),
]
CONTAINER = r"(?:cans?|tins?|packs?|packets?|bags?|jars?|pots?|tubs?|cartons?|pouch(?:es)?|bottles?|blocks?|balls?)"

# ---------------------------------------------------------------- dictionnaire des ingrédients (anglais → français)
# (anglais, français singulier, français pluriel ou None si identique/ invariable)
DICT = [
    ("skinless boneless chicken breast", "blanc de poulet", "blancs de poulet"), ("boneless skinless chicken breast", "blanc de poulet", "blancs de poulet"),
    ("skinless chicken breast", "blanc de poulet", "blancs de poulet"), ("chicken breast fillet", "filet de poulet", "filets de poulet"),
    ("chicken breast", "blanc de poulet", "blancs de poulet"), ("boneless skinless chicken thigh", "haut de cuisse de poulet désossé", "hauts de cuisse de poulet désossés"),
    ("skinless chicken thigh fillet", "haut de cuisse de poulet désossé", "hauts de cuisse de poulet désossés"), ("chicken thigh fillet", "haut de cuisse de poulet désossé", "hauts de cuisse de poulet désossés"),
    ("chicken thigh", "haut de cuisse de poulet", "hauts de cuisse de poulet"), ("chicken drumstick", "pilon de poulet", "pilons de poulet"),
    ("chicken leg", "cuisse de poulet", "cuisses de poulet"), ("whole chicken", "poulet entier", "poulets entiers"), ("cooked chicken", "poulet cuit", None),
    ("chicken mince", "poulet haché", None), ("chicken", "poulet", None), ("turkey breast", "blanc de dinde", "blancs de dinde"), ("turkey mince", "dinde hachée", None),
    ("minced turkey", "dinde hachée", None), ("ground turkey", "dinde hachée", None), ("turkey", "dinde", None),
    ("extra lean beef mince", "bœuf haché 5 % MG", None), ("lean beef mince", "bœuf haché 5 % MG", None), ("beef mince", "bœuf haché", None), ("minced beef", "bœuf haché", None),
    ("lean ground beef", "bœuf haché 5 % MG", None), ("ground beef", "bœuf haché", None), ("braising steak", "bœuf à braiser", None), ("stewing beef", "bœuf à braiser", None),
    ("sirloin steak", "faux-filet", "faux-filets"), ("rump steak", "rumsteck", None), ("steak", "steak", "steaks"), ("beef", "bœuf", None),
    ("lamb mince", "agneau haché", None), ("minced lamb", "agneau haché", None), ("lamb leg", "gigot d'agneau", None), ("lamb", "agneau", None), ("venison", "chevreuil", None), ("duck breast", "magret de canard", "magrets de canard"),
    ("salmon fillet", "pavé de saumon", "pavés de saumon"), ("smoked salmon", "saumon fumé", None), ("salmon", "saumon", None),
    ("cod fillet", "dos de cabillaud", "dos de cabillaud"), ("cod loin", "dos de cabillaud", "dos de cabillaud"), ("cod", "cabillaud", None), ("haddock", "haddock", None),
    ("smoked haddock", "haddock fumé", None), ("white fish fillet", "filet de poisson blanc", "filets de poisson blanc"), ("white fish", "poisson blanc", None),
    ("hake", "merlu", None), ("sea bass fillet", "filet de bar", "filets de bar"), ("sea bass", "bar", None), ("mackerel fillet", "filet de maquereau", "filets de maquereau"),
    ("mackerel", "maquereau", "maquereaux"), ("trout", "truite", "truites"), ("tuna steak", "steak de thon", "steaks de thon"), ("tuna in spring water", "thon au naturel", None),
    ("tinned tuna", "thon en conserve", None), ("canned tuna", "thon en conserve", None), ("tuna", "thon", None), ("sardines", "sardines", None),
    ("king prawn", "grosse crevette", "grosses crevettes"), ("raw king prawn", "grosse crevette crue", "grosses crevettes crues"), ("prawn", "crevette", "crevettes"),
    ("shrimp", "crevette", "crevettes"), ("scallop", "noix de Saint-Jacques", "noix de Saint-Jacques"), ("mussels", "moules", None), ("squid", "calamar", "calamars"),
    ("egg white", "blanc d'œuf", "blancs d'œufs"), ("egg yolk", "jaune d'œuf", "jaunes d'œufs"), ("free-range egg", "œuf", "œufs"), ("egg", "œuf", "œufs"),
    ("extra virgin olive oil", "huile d'olive vierge extra", None), ("olive oil", "huile d'olive", None), ("vegetable oil", "huile végétale", None), ("rapeseed oil", "huile de colza", None),
    ("sunflower oil", "huile de tournesol", None), ("sesame oil", "huile de sésame", None), ("toasted sesame oil", "huile de sésame grillé", None), ("coconut oil", "huile de coco", None),
    ("low-calorie cooking spray", "huile en spray", None), ("low calorie cooking spray", "huile en spray", None), ("cooking spray", "huile en spray", None), ("frylight", "huile en spray", None),
    ("unsalted butter", "beurre doux", None), ("salted butter", "beurre demi-sel", None), ("butter", "beurre", None), ("ghee", "ghee", None),
    ("red onion", "oignon rouge", "oignons rouges"), ("white onion", "oignon blanc", "oignons blancs"), ("brown onion", "oignon jaune", "oignons jaunes"), ("yellow onion", "oignon jaune", "oignons jaunes"),
    ("spring onion", "oignon nouveau", "oignons nouveaux"), ("scallion", "oignon nouveau", "oignons nouveaux"), ("green onion", "oignon nouveau", "oignons nouveaux"), ("shallot", "échalote", "échalotes"),
    ("onion", "oignon", "oignons"), ("garlic clove", "gousse d'ail", "gousses d'ail"), ("garlic granules", "ail en poudre", None), ("garlic powder", "ail en poudre", None),
    ("garlic paste", "purée d'ail", None), ("garlic cloves", "gousse d'ail", "gousses d'ail"), ("garlic", "ail", None), ("ginger paste", "purée de gingembre", None), ("ground ginger", "gingembre en poudre", None), ("ginger", "gingembre", None),
    ("leek", "poireau", "poireaux"), ("celery stick", "branche de céleri", "branches de céleri"), ("celery stalk", "branche de céleri", "branches de céleri"), ("celery", "céleri", None), ("carrot", "carotte", "carottes"), ("courgette", "courgette", "courgettes"), ("zucchini", "courgette", "courgettes"),
    ("aubergine", "aubergine", "aubergines"), ("eggplant", "aubergine", "aubergines"), ("red pepper", "poivron rouge", "poivrons rouges"), ("yellow pepper", "poivron jaune", "poivrons jaunes"),
    ("green pepper", "poivron vert", "poivrons verts"), ("bell pepper", "poivron", "poivrons"), ("roasted red pepper", "poivron rouge grillé", "poivrons rouges grillés"),
    ("red chilli", "piment rouge", "piments rouges"), ("green chilli", "piment vert", "piments verts"), ("chilli flakes", "piment en flocons", None), ("red chili flakes", "piment en flocons", None),
    ("chilli powder", "piment en poudre", None), ("chili powder", "piment en poudre", None), ("chipotle paste", "pâte de chipotle", None), ("chilli", "piment", "piments"), ("jalapeño", "jalapeño", "jalapeños"),
    ("cherry tomato", "tomate cerise", "tomates cerises"), ("chopped tomatoes", "tomates concassées", None), ("crushed tomatoes", "tomates concassées", None), ("diced tomatoes", "tomates en dés", None),
    ("plum tomatoes", "tomates pelées", None), ("sun-dried tomato", "tomate séchée", "tomates séchées"), ("tomato purée", "concentré de tomate", None), ("tomato puree", "concentré de tomate", None),
    ("tomato paste", "concentré de tomate", None), ("passata", "coulis de tomate", None), ("tomato sauce", "sauce tomate", None), ("tomato", "tomate", "tomates"),
    ("baby spinach", "pousses d'épinard", None), ("spinach", "épinards", None), ("kale", "chou kale", None), ("cavolo nero", "chou noir", None), ("rocket", "roquette", None), ("arugula", "roquette", None),
    ("little gem lettuce", "sucrine", "sucrines"), ("lettuce", "salade", "salades"), ("mixed salad leaves", "mesclun", None), ("salad leaves", "salade", None), ("cucumber", "concombre", "concombres"),
    ("broccoli", "brocoli", None), ("tenderstem broccoli", "brocolis tiges", None), ("cauliflower", "chou-fleur", "choux-fleurs"), ("cabbage", "chou", "choux"), ("red cabbage", "chou rouge", None),
    ("brussels sprouts", "choux de Bruxelles", None), ("green beans", "haricots verts", None), ("fine beans", "haricots verts", None), ("mangetout", "pois gourmands", None), ("sugar snap peas", "pois gourmands", None),
    ("frozen peas", "petits pois surgelés", None), ("peas", "petits pois", None), ("sweetcorn", "maïs", None), ("corn", "maïs", None), ("edamame beans", "edamame", None), ("edamame", "edamame", None),
    ("mushroom", "champignon", "champignons"), ("chestnut mushrooms", "champignons de Paris", None), ("button mushrooms", "champignons de Paris", None), ("asparagus", "asperges", None),
    ("butternut squash", "courge butternut", "courges butternut"), ("pumpkin", "potiron", None), ("sweet potato", "patate douce", "patates douces"), ("baby potatoes", "pommes de terre grenaille", None),
    ("new potatoes", "pommes de terre nouvelles", None), ("russet potato", "pomme de terre", "pommes de terre"), ("baking potato", "pomme de terre à four", "pommes de terre à four"),
    ("maris piper potato", "pomme de terre", "pommes de terre"), ("potato", "pomme de terre", "pommes de terre"), ("beetroot", "betterave", "betteraves"), ("parsnip", "panais", None),
    ("avocado", "avocat", "avocats"), ("lemon juice", "jus de citron", None), ("lemon zest", "zeste de citron", None), ("lemon", "citron", "citrons"), ("lime juice", "jus de citron vert", None), ("lime", "citron vert", "citrons verts"),
    ("orange", "orange", "oranges"), ("apple", "pomme", "pommes"), ("banana", "banane", "bananes"), ("mango", "mangue", "mangues"), ("pineapple", "ananas", None),
    ("blueberries", "myrtilles", None), ("raspberries", "framboises", None), ("strawberries", "fraises", None), ("mixed berries", "fruits rouges", None), ("frozen berries", "fruits rouges surgelés", None),
    ("fresh coriander", "coriandre fraîche", None), ("coriander leaves", "coriandre fraîche", None), ("cilantro", "coriandre fraîche", None), ("ground coriander", "coriandre en poudre", None), ("coriander", "coriandre", None),
    ("flat-leaf parsley", "persil plat", None), ("parsley", "persil", None), ("basil", "basilic", None), ("mint", "menthe", None), ("dill", "aneth", None), ("chives", "ciboulette", None),
    ("thyme", "thym", None), ("rosemary", "romarin", None), ("oregano", "origan", None), ("sage", "sauge", None), ("bay leaf", "feuille de laurier", "feuilles de laurier"), ("bay leaves", "feuilles de laurier", None),
    ("dried mixed herbs", "herbes de Provence", None), ("mixed herbs", "herbes de Provence", None), ("italian seasoning", "herbes italiennes", None),
    ("ground cumin", "cumin en poudre", None), ("cumin seeds", "graines de cumin", None), ("cumin", "cumin", None), ("smoked paprika", "paprika fumé", None), ("sweet smoked paprika", "paprika fumé doux", None),
    ("paprika", "paprika", None), ("turmeric", "curcuma", None), ("ground turmeric", "curcuma", None), ("garam masala", "garam masala", None), ("curry powder", "curry en poudre", None),
    ("curry paste", "pâte de curry", None), ("thai red curry paste", "pâte de curry rouge", None), ("thai green curry paste", "pâte de curry vert", None), ("tikka masala paste", "pâte tikka masala", None),
    ("ground cinnamon", "cannelle en poudre", None), ("cinnamon", "cannelle", None), ("nutmeg", "muscade", None), ("cayenne pepper", "piment de Cayenne", None), ("cayenne", "piment de Cayenne", None),
    ("five-spice", "cinq-épices", None), ("chinese five spice", "cinq-épices", None), ("fennel seeds", "graines de fenouil", None), ("mustard seeds", "graines de moutarde", None),
    ("sea salt", "sel", None), ("salt", "sel", None), ("black pepper", "poivre noir", None), ("ground black pepper", "poivre noir", None), ("pepper", "poivre", None),
    ("chicken stock", "bouillon de volaille", None), ("vegetable stock", "bouillon de légumes", None), ("beef stock", "bouillon de bœuf", None), ("fish stock", "fumet de poisson", None),
    ("stock cube", "cube de bouillon", "cubes de bouillon"), ("chicken stock cube", "cube de bouillon de volaille", "cubes de bouillon de volaille"), ("vegetable stock cube", "cube de bouillon de légumes", "cubes de bouillon de légumes"),
    ("beef stock cube", "cube de bouillon de bœuf", "cubes de bouillon de bœuf"), ("stock pot", "bouillon concentré", None), ("stock", "bouillon", None), ("broth", "bouillon", None),
    ("soy sauce", "sauce soja", None), ("light soy sauce", "sauce soja claire", None), ("dark soy sauce", "sauce soja foncée", None), ("reduced-salt soy sauce", "sauce soja allégée en sel", None),
    ("tamari", "tamari", None), ("fish sauce", "sauce nuoc-mâm", None), ("oyster sauce", "sauce huître", None), ("hoisin sauce", "sauce hoisin", None), ("sriracha", "sriracha", None),
    ("sweet chilli sauce", "sauce chili douce", None), ("hot sauce", "sauce piquante", None), ("worcestershire sauce", "sauce Worcestershire", None), ("teriyaki sauce", "sauce teriyaki", None),
    ("rice vinegar", "vinaigre de riz", None), ("rice wine vinegar", "vinaigre de riz", None), ("red wine vinegar", "vinaigre de vin rouge", None), ("white wine vinegar", "vinaigre de vin blanc", None),
    ("cider vinegar", "vinaigre de cidre", None), ("apple cider vinegar", "vinaigre de cidre", None), ("balsamic vinegar", "vinaigre balsamique", None), ("vinegar", "vinaigre", None),
    ("dijon mustard", "moutarde de Dijon", None), ("wholegrain mustard", "moutarde à l'ancienne", None), ("english mustard", "moutarde forte", None), ("mustard", "moutarde", None),
    ("mayonnaise", "mayonnaise", None), ("light mayonnaise", "mayonnaise allégée", None), ("ketchup", "ketchup", None), ("pesto", "pesto", None), ("harissa", "harissa", None), ("tahini", "tahini", None),
    ("honey", "miel", None), ("runny honey", "miel liquide", None), ("maple syrup", "sirop d'érable", None), ("golden syrup", "sirop de sucre roux", None), ("agave syrup", "sirop d'agave", None),
    ("caster sugar", "sucre en poudre", None), ("granulated sugar", "sucre en poudre", None), ("light brown soft sugar", "sucre roux", None), ("brown sugar", "sucre roux", None), ("icing sugar", "sucre glace", None),
    ("sugar", "sucre", None), ("sweetener", "édulcorant", None), ("granulated sweetener", "édulcorant en poudre", None),
    ("plain flour", "farine", None), ("all-purpose flour", "farine", None), ("self-raising flour", "farine avec levure incorporée", None), ("self-rising flour", "farine avec levure incorporée", None),
    ("wholemeal flour", "farine complète", None), ("whole wheat pastry flour", "farine complète", None), ("whole wheat flour", "farine complète", None), ("wholewheat flour", "farine complète", None), ("strong white bread flour", "farine T65", None), ("cornflour", "fécule de maïs", None), ("cornstarch", "fécule de maïs", None),
    ("baking powder", "levure chimique", None), ("bicarbonate of soda", "bicarbonate de soude", None), ("baking soda", "bicarbonate de soude", None), ("dried yeast", "levure de boulanger sèche", None),
    ("vanilla extract", "extrait de vanille", None), ("cocoa powder", "cacao en poudre", None), ("dark chocolate chips", "pépites de chocolat noir", None), ("chocolate chips", "pépites de chocolat", None), ("dark chocolate", "chocolat noir", None), ("milk chocolate", "chocolat au lait", None),
    ("protein powder", "protéine en poudre", None), ("vanilla protein powder", "protéine en poudre vanille", None), ("chocolate protein powder", "protéine en poudre chocolat", None), ("whey protein", "protéine whey", None),
    ("semi-skimmed milk", "lait demi-écrémé", None), ("skimmed milk", "lait écrémé", None), ("whole milk", "lait entier", None), ("almond milk", "lait d'amande", None), ("oat milk", "lait d'avoine", None), ("milk", "lait", None),
    ("double cream", "crème entière", None), ("heavy cream", "crème entière", None), ("single cream", "crème liquide", None), ("light cream", "crème légère", None), ("soured cream", "crème aigre", None),
    ("sour cream", "crème aigre", None), ("light sour cream", "crème aigre allégée", None), ("crème fraîche", "crème fraîche", None), ("half-fat crème fraîche", "crème fraîche allégée", None),
    ("reduced-fat crème fraîche", "crème fraîche allégée", None), ("fat-free greek yogurt", "yaourt grec 0 %", None), ("0% greek yogurt", "yaourt grec 0 %", None), ("fat-free greek yoghurt", "yaourt grec 0 %", None),
    ("greek yogurt", "yaourt grec", None), ("greek yoghurt", "yaourt grec", None), ("greek-style yogurt", "yaourt à la grecque", None), ("natural yogurt", "yaourt nature", None),
    ("natural yoghurt", "yaourt nature", None), ("plain yogurt", "yaourt nature", None), ("yogurt", "yaourt", None), ("yoghurt", "yaourt", None), ("skyr", "skyr", None), ("quark", "fromage blanc", None),
    ("cottage cheese", "cottage cheese", None), ("low-fat cottage cheese", "cottage cheese allégé", None), ("cream cheese", "fromage frais", None), ("light cream cheese", "fromage frais allégé", None),
    ("soft cheese", "fromage frais", None), ("light soft cheese", "fromage frais allégé", None), ("ricotta", "ricotta", None), ("mascarpone", "mascarpone", None),
    ("reduced-fat feta", "feta allégée", None), ("reduced fat feta", "feta allégée", None), ("feta cheese", "feta", None), ("feta", "feta", None), ("halloumi", "halloumi", None),
    ("light mozzarella", "mozzarella allégée", None), ("mozzarella ball", "boule de mozzarella", "boules de mozzarella"), ("mozzarella", "mozzarella", None), ("burrata", "burrata", None),
    ("reduced-fat cheddar", "cheddar allégé", None), ("reduced fat cheddar", "cheddar allégé", None), ("mature cheddar", "cheddar affiné", None), ("cheddar", "cheddar", None),
    ("parmesan", "parmesan", None), ("parmigiano reggiano", "parmesan", None), ("grana padano", "grana padano", None), ("goat's cheese", "fromage de chèvre", None), ("goats cheese", "fromage de chèvre", None),
    ("gruyère", "gruyère", None), ("gruyere", "gruyère", None), ("blue cheese", "bleu", None), ("paneer", "paneer", None), ("tofu", "tofu", None), ("firm tofu", "tofu ferme", None), ("extra firm tofu", "tofu extra-ferme", None),
    ("tempeh", "tempeh", None), ("basmati rice", "riz basmati", None), ("jasmine rice", "riz jasmin", None), ("brown rice", "riz complet", None), ("wholegrain rice", "riz complet", None),
    ("long-grain rice", "riz long", None), ("arborio rice", "riz arborio", None), ("risotto rice", "riz à risotto", None), ("microwave rice", "riz précuit", None), ("cooked rice", "riz cuit", None),
    ("cauliflower rice", "riz de chou-fleur", None), ("rice", "riz", None), ("wholewheat pasta", "pâtes complètes", None), ("wholemeal pasta", "pâtes complètes", None), ("pasta", "pâtes", None),
    ("spaghetti", "spaghetti", None), ("linguine", "linguine", None), ("penne", "penne", None), ("fusilli", "fusilli", None), ("rigatoni", "rigatoni", None), ("orzo", "orzo", None),
    ("tagliatelle", "tagliatelles", None), ("lasagne sheets", "feuilles de lasagne", None), ("gnocchi", "gnocchis", None), ("macaroni", "macaroni", None),
    ("egg noodles", "nouilles aux œufs", None), ("rice noodles", "nouilles de riz", None), ("udon noodles", "nouilles udon", None), ("noodles", "nouilles", None),
    ("couscous", "semoule", None), ("giant couscous", "perles de blé", None), ("bulgur wheat", "boulgour", None), ("bulgur", "boulgour", None), ("quinoa", "quinoa", None), ("pearl barley", "orge perlé", None),
    ("rolled oats", "flocons d'avoine", None), ("porridge oats", "flocons d'avoine", None), ("oats", "flocons d'avoine", None), ("granola", "granola", None),
    ("red lentils", "lentilles corail", None), ("green lentils", "lentilles vertes", None), ("puy lentils", "lentilles vertes du Puy", None), ("lentils", "lentilles", None),
    ("chickpeas", "pois chiches", None), ("black beans", "haricots noirs", None), ("kidney beans", "haricots rouges", None), ("red kidney beans", "haricots rouges", None),
    ("cannellini beans", "haricots blancs", None), ("butter beans", "haricots de Lima", None), ("borlotti beans", "haricots borlotti", None), ("mixed beans", "mélange de haricots", None),
    ("baked beans", "haricots à la sauce tomate", None), ("pinto beans", "haricots pinto", None), ("beans", "haricots", None),
    ("coconut milk", "lait de coco", None), ("light coconut milk", "lait de coco allégé", None), ("reduced-fat coconut milk", "lait de coco allégé", None), ("coconut cream", "crème de coco", None),
    ("peanut butter", "beurre de cacahuète", None), ("almond butter", "purée d'amande", None), ("peanuts", "cacahuètes", None), ("cashews", "noix de cajou", None), ("cashew nuts", "noix de cajou", None),
    ("almonds", "amandes", None), ("flaked almonds", "amandes effilées", None), ("ground almonds", "poudre d'amande", None), ("walnuts", "noix", None), ("pecans", "noix de pécan", None),
    ("pine nuts", "pignons de pin", None), ("pistachios", "pistaches", None), ("hazelnuts", "noisettes", None), ("sesame seeds", "graines de sésame", None), ("chia seeds", "graines de chia", None),
    ("pumpkin seeds", "graines de courge", None), ("sunflower seeds", "graines de tournesol", None), ("flaxseed", "graines de lin", None), ("linseed", "graines de lin", None), ("desiccated coconut", "noix de coco râpée", None),
    ("tortilla wraps", "tortillas de blé", None), ("tortilla wrap", "tortilla de blé", "tortillas de blé"), ("wholemeal tortilla wrap", "tortilla complète", "tortillas complètes"), ("tortillas", "tortillas", None), ("tortilla", "tortilla", "tortillas"),
    ("wraps", "wraps", None), ("wrap", "wrap", "wraps"), ("pitta bread", "pain pita", "pains pita"), ("pitta", "pain pita", "pains pita"), ("pita bread", "pain pita", "pains pita"), ("naan bread", "pain naan", "pains naan"), ("naan", "pain naan", "pains naan"),
    ("burger bun", "pain à burger", "pains à burger"), ("brioche bun", "pain brioché", "pains briochés"), ("bread roll", "petit pain", "petits pains"), ("english muffin", "muffin anglais", "muffins anglais"),
    ("bagel", "bagel", "bagels"), ("sourdough bread", "pain au levain", None), ("sourdough", "pain au levain", None), ("wholemeal bread", "pain complet", None), ("bread", "pain", None),
    ("breadcrumbs", "chapelure", None), ("panko breadcrumbs", "chapelure panko", None), ("panko", "chapelure panko", None), ("puff pastry", "pâte feuilletée", None), ("shortcrust pastry", "pâte brisée", None),
    ("filo pastry", "pâte filo", None), ("filo", "pâte filo", None), ("pizza base", "pâte à pizza", None), ("pizza dough", "pâte à pizza", None),
    ("olives", "olives", None), ("black olives", "olives noires", None), ("kalamata olives", "olives de Kalamata", None), ("capers", "câpres", None), ("gherkins", "cornichons", None),
    ("water", "eau", None), ("boiling water", "eau bouillante", None), ("cold water", "eau froide", None), ("ice", "glaçons", None), ("white wine", "vin blanc", None), ("red wine", "vin rouge", None),
    ("lemongrass", "citronnelle", None), ("kaffir lime leaves", "feuilles de combava", None), ("star anise", "anis étoilé", None), ("cardamom pods", "gousses de cardamome", None), ("cloves", "clous de girofle", None),
    ("miso paste", "pâte miso", None), ("white miso", "miso blanc", None), ("gochujang", "gochujang", None), ("sambal oelek", "sambal oelek", None), ("salsa", "salsa", None), ("guacamole", "guacamole", None),
    ("hummus", "houmous", None), ("houmous", "houmous", None), ("tzatziki", "tzatziki", None), ("cornichons", "cornichons", None), ("sauerkraut", "choucroute", None), ("kimchi", "kimchi", None),
    ("pomegranate seeds", "graines de grenade", None), ("dates", "dattes", None), ("medjool dates", "dattes Medjool", None), ("raisins", "raisins secs", None), ("sultanas", "raisins secs", None), ("dried cranberries", "cranberries séchées", None),
]
DICT.sort(key=lambda x: -len(x[0]))
_DICT_RE = [(re.compile(r"^" + re.escape(e).replace(r"\ ", r"[\s-]+") + r"(?:e?s)?\b", re.I), fs, fp) for e, fs, fp in DICT]

NOISE = r"(?:large|medium|small|big|extra[- ]large|good[- ]quality|free[- ]range|higher[- ]welfare|organic|ripe|heaped|level|rounded|generous|good|quality|fresh(?:ly)?|about|approx\.?|around|roughly|thick|thin|plump|juicy|firm|100%|british|unwaxed|waxy|floury)\s+"
# préparation placée avant le nom (« grated parmesan ») : retirée du nom, gardée comme préparation
PREFIX_PREP = r"(chopped|diced|sliced|grated|crushed|minced|pureed|puréed|mashed|shredded|toasted|melted|softened|beaten|cubed|crumbled|halved|peeled|trimmed)\s+"
PREP_WORDS = (r"finely|roughly|thinly|coarsely|freshly|chopped|diced|sliced|grated|crushed|minced|beaten|melted|softened|peeled|deseeded|seeded|halved|quartered|trimmed|drained|"
              r"rinsed|torn|shredded|zested|juiced|cut|plus|to serve|to taste|for (?:the|drizzling|frying|greasing|dusting|serving|brushing|garnish)|at room temperature|leaves picked|"
              r"leaves only|picked|squeezed|mashed|toasted|cubed|julienned|spiralized|spiralised|crumbled|warmed|cooled|defrosted|thawed|optional|cooked|uncooked|dried|frozen|tinned|canned|"
              r"stalks? removed|stones? removed|skin on|skin removed|bones? removed|or |and |such as|we used|i used|see |about|approximately|in spring water|in water|in brine|in oil|divided|separated|sifted|packed|lightly|well|very|room temperature|chilled|cold|hot|boiled|steamed")
PREP_RE = re.compile(r"\b(" + PREP_WORDS + r")\b", re.I)

PREP_FR = [
    (r"plus (?:extra|a little extra|more) (?:for dusting)", "+ un peu pour fariner"), (r"plus (?:extra|a little extra|more) (?:to serve|for serving)", "+ un peu pour servir"),
    (r"plus (?:extra|a little extra|more) for (?:the tin|greasing)", "+ un peu pour le moule"), (r"plus (?:extra|a little extra|more) (?:for drizzling|to drizzle)", "+ un peu pour arroser"),
    (r"pureed|puréed", "mixé"),
    (r"finely chopped", "finement haché"), (r"roughly chopped", "grossièrement haché"), (r"chopped", "haché"), (r"finely sliced|thinly sliced", "finement émincé"), (r"sliced", "émincé"),
    (r"diced|cubed|cut into (?:small )?(?:cubes|chunks|pieces)", "coupé en dés"), (r"grated", "râpé"), (r"crushed", "écrasé"), (r"minced", "haché"), (r"beaten", "battu"), (r"melted", "fondu"),
    (r"softened", "ramolli"), (r"peeled", "épluché"), (r"deseeded|seeded", "épépiné"), (r"halved", "coupé en deux"), (r"quartered", "coupé en quatre"), (r"trimmed", "paré"),
    (r"drained and rinsed|rinsed and drained", "égoutté et rincé"), (r"drained", "égoutté"), (r"rinsed", "rincé"), (r"torn", "déchiré"), (r"shredded", "effiloché"), (r"zested and juiced", "zesté et pressé"),
    (r"zested", "zesté"), (r"juiced", "pressé"), (r"to serve", "pour servir"), (r"to taste", "selon le goût"), (r"for frying", "pour la cuisson"), (r"for drizzling", "pour arroser"),
    (r"for greasing", "pour le moule"), (r"for dusting", "pour fariner"), (r"for brushing", "pour badigeonner"), (r"leaves picked|leaves only", "les feuilles seulement"), (r"toasted", "grillé"),
    (r"mashed", "écrasé"), (r"crumbled", "émietté"), (r"at room temperature", "à température ambiante"), (r"cooked", "cuit"), (r"frozen", "surgelé"), (r"optional", "facultatif"),
]


def dict_name(s, plural):
    s = s.strip()
    for rx, fs, fp in _DICT_RE:
        m = rx.match(s)
        if m:
            fr = (fp or (fs if fs.endswith(("s", "x", "z")) else fs + "s")) if plural else fs
            return fr, s[m.end():].strip(" ,;-")
    return None, s


def prep_fr(s):
    s = re.sub(r"\s+", " ", s or "").strip(" ,;-")
    if not s:
        return ""
    low = s.lower()
    if re.fullmatch(r"\d+ % MG", s):
        return s
    for rx, fr in PREP_FR:
        if re.fullmatch(rx, low):
            return fr
    try:
        return post(mt(s)).strip(" .")
    except Exception:
        return ""


PP = ["haché", "émincé", "râpé", "écrasé", "battu", "fondu", "ramolli", "épluché", "épépiné", "coupé", "paré", "égoutté", "rincé", "déchiré", "effiloché", "zesté", "pressé",
      "grillé", "émietté", "cuit", "surgelé", "mixé"]
MASC_E = re.compile(r"(beurre|fromage|gingembre|concombre|sucre|poivre|cumin|persil|lait|riz|thon|saumon|bœuf|poulet|ail|sel|miel|yaourt|skyr|tofu|chou|céleri|piment|basilic|thym|romarin|origan|aneth|maïs|pesto|ketchup|vinaigre|bouillon|cube|parmesan|cheddar|gruyère|halloumi|paneer|pain|bagel|wrap|naan|pita|quinoa|boulgour|blanc|haut|pilon|pavé|dos|filet|steak|magret|jaune|oignon|poireau|poivron|avocat|citron|champignon|brocoli|chorizo|lard|jambon|haddock|cabillaud|merlu|bar|maquereau)\b", re.I)


def agree(prep, fr, plural):
    if not prep:
        return prep
    words = fr.lower().split(" ")
    first = words[0]
    SING = ("riz", "maïs", "jus", "anis", "bœuf", "pois", "dos", "cassis", "ananas", "noix")
    pl = plural or (first.endswith(("s", "x")) and first not in SING) or (first in ("pois", "noix") and len(words) > 1 and words[1].endswith("s"))
    base = re.sub(r"(?<=[^s])s$|x$", "", first) if pl and first not in SING else first
    fem = (base.endswith("e") or base.endswith("a")) and not MASC_E.match(base) and not base.endswith("é") and base not in ("quinoa",)
    def f(m):
        w = m.group(0)
        return w + ("e" if fem else "") + ("s" if pl else "")
    return re.sub(r"\b(" + "|".join(PP) + r")\b", f, prep)


def cap(s):
    return s[:1].upper() + s[1:] if s else s


def ing_line(line):
    """« 2 x 400g cans chickpeas, drained » → « 800 g Pois chiches, égouttés »"""
    s = unfrac(re.sub(r"<[^>]+>", " ", line)).replace("&amp;", "&").replace("&#39;", "'").replace("’", "'")
    s = re.sub(r"\s+", " ", s).strip(" •*-–")
    if not s:
        return None
    # poids donné entre parenthèses : (140g each) → total
    each = re.search(r"\(\s*(?:about |approx\.? )?(\d+)\s*g\s*each", s, re.I)
    s = re.sub(r"\((?:[^()]|\([^()]*\))*\)", " ", s)  # notes entre parenthèses
    s = re.sub(r"\s+", " ", s).strip()
    low = s.lower()
    if re.match(r"^salt(?:\s*(?:and|&)\s*|,\s*)(?:freshly )?(?:cracked |ground )?(?:black )?pepper", low):
        return "Sel et poivre"
    m = re.match(r"^(zest and juice|juice and zest|juice|zest)(?:\s+of)?\s+(" + NUM + r")\s+(?:large |small |unwaxed )?(lemon|lime|orange)s?\b", low)
    if m:
        what = {"zest and juice": "zesté et pressé", "juice and zest": "zesté et pressé", "juice": "pressé", "zest": "zesté"}[m.group(1)]
        q0 = tonum(m.group(2)); fr0 = {"lemon": "citron", "lime": "citron vert", "orange": "orange"}[m.group(3)]
        pl0 = (q0 or 1) > 1
        name0 = (fr0 + ("s" if pl0 and fr0 != "citron vert" else "")) if fr0 != "citron vert" else ("citrons verts" if pl0 else "citron vert")
        return f"{fmtq(q0)} {cap(name0)}, " + agree(what, name0, pl0)
    m = re.match(r"^(" + NUM + r")\s*cm\s+(?:piece|chunk|knob|thumb)\s+(?:of\s+)?(?:fresh\s+)?(.+)$", s, re.I)
    if m:
        fr0, _ = dict_name(m.group(2), False)
        if fr0:
            return f"1 morceau de {fr0} ({m.group(1)} cm)"
    # double mesure « 125g / 4 oz » ou « 1 lb / 500g » : on garde la mesure métrique
    s = re.sub(r"^(" + NUM + r")\s*(?:lbs?|oz|cups?)\s*/\s*(" + NUM + r"\s*(?:g|kg|ml|l)\b)", r"\2", s, flags=re.I)
    s = re.sub(r"^(" + NUM + r"\s*(?:g|kg|ml|l)\b)\s*/\s*" + NUM + r"\s*(?:lbs?|oz|cups?|tbsp|fl oz)\b", r"\1", s, flags=re.I)
    mult = 1.0
    m = re.match(r"^(\d+)\s*x\s+", s, re.I)
    if m:
        mult = float(m.group(1)); s = s[m.end():]
    q = None
    m = re.match(r"^(" + NUM + r")(?:\s*(?:-|–|to)\s*" + NUM + r")?\s*", s)
    if m:
        q = tonum(m.group(1)); s = s[m.end():]
    unit, fac = None, 1
    m = UNIT_RE.match(s)
    if m and q is not None:
        tok = m.group(1).lower()
        for rx, (u, f) in UNITS:
            if re.fullmatch(rx, tok, re.I):
                unit, fac = u, f
                break
        s = s[m.end():]
    elif q is None:
        m = re.match(r"^(a |an |one )?(pinch|handful|splash|drizzle|dash|knob|small bunch|bunch|sprig)\s+(?:of\s+)?", s, re.I)
        if m:
            q = 1
            unit = {"pinch": "pincée", "handful": "poignée", "splash": "trait", "drizzle": "filet", "dash": "trait", "knob": "noix", "small bunch": "bouquet", "bunch": "bouquet", "sprig": "brin"}[m.group(2).lower()]
            s = s[m.end():]
    # « 400g can chopped tomatoes » : on garde le poids, le contenant disparaît
    s = re.sub(r"^" + CONTAINER + r"\s+(?:of\s+)?", "", s, flags=re.I)
    s = re.sub(r"^(?:" + NOISE + r")+", "", s, flags=re.I)
    s = re.sub(r"^(?:of\s+)", "", s, flags=re.I)
    pre_prep = ""
    if dict_name(s, False)[0] is None:
        m = re.match(r"^" + PREFIX_PREP, s, re.I)
        if m:
            pre_prep = m.group(1); s = re.sub(r"^(?:" + NOISE + r")+", "", s[m.end():], flags=re.I)
    name_en = s
    # quantité finale
    if q is not None:
        q *= mult
    if unit == "cup":
        g = None
        for rx, d in CUP_G:
            if re.search(r"\b(" + rx + r")", name_en, re.I):
                g = d
        if g:
            unit, q = "g", q * g
        else:
            unit, q = "ml", q * 240
    elif unit in ("g", "ml") and fac != 1:
        q = q * fac
    elif unit == "g" and fac == 1:
        pass
    if unit == "boîte" and q:
        unit = "boîte"
    if each and q and not unit:
        unit, q = "g", q * float(each.group(1))
    if unit in ("g", "ml") and q:
        q = r5(q)
    plural = bool(q and q > 1 and not unit)
    fr, rest = dict_name(name_en, plural)
    if fr is None:
        # nom inconnu : on coupe au premier mot de préparation, le reste est traduit
        m = PREP_RE.search(name_en)
        nm = name_en[: m.start()].strip(" ,") if m and m.start() > 0 else name_en
        rest = name_en[len(nm):]
        nm = re.sub(r"^(?:" + NOISE + r")+", "", nm, flags=re.I)
        try:
            fr = post(mt(nm)).strip(" .")
        except Exception:
            return None
        fr = re.sub(r"^(?:des?|du|les?|la|l')\s*", "", fr, flags=re.I) if not re.match(r"^(?:l'|d')", fr) else fr
    rest = re.sub(r"^\s*,?\s*", "", rest or "")
    rest = re.sub(r"^(\d+)\s*%\s*fat\b", r"\1 % MG", rest, flags=re.I)
    if pre_prep and not rest:
        rest = pre_prep
    if unit == "gousse" and fr in ("ail",):
        fr = "ail"
    pf = prep_fr(rest) if rest else ""
    qs = fmtq(q) if q is not None else ""
    if unit == "gousse":
        out = f"{qs} gousse{'s' if (q or 0) > 1 else ''} d'{fr}" if fr in ("ail",) else f"{qs} gousse{'s' if (q or 0) > 1 else ''} {fr}"
    elif unit:
        u = unit
        if u in ("pincée", "poignée", "tranche", "feuille", "branche", "boîte", "tête", "brin", "morceau", "trait", "dose", "filet") and (q or 0) > 1:
            u = u + "s"
        if u == "paquet" and (q or 0) > 1:
            u = "paquets"
        out = f"{qs} {u} {cap(fr)}" if u in ("g", "ml", "cl", "cs", "cc") else f"{qs} {u} de {fr}"
    else:
        out = f"{qs} {cap(fr)}".strip() if qs else cap(fr)
    out = re.sub(r"\bde ([aeiouyéèêœ]|huile|herbe|huître)", r"d'\1", out)
    if pf:
        out += (" " if pf.startswith("+") else ", ") + agree(pf, fr, plural)
    return re.sub(r"\s+", " ", out).strip()


# ---------------------------------------------------------------- étapes et titres
PRE = [
    (r"(\d{2,3})\s*°?\s*C\s*/\s*(\d{2,3})\s*°?\s*C\s*fan\s*/\s*gas\s*(?:mark\s*)?\d+", r"\1°C (\2°C fan oven)"),
    (r"(\d{2,3})\s*°?\s*C\s*/\s*(\d{2,3})\s*°?\s*C\s*fan", r"\1°C (\2°C fan oven)"),
    (r",?\s*gas\s*(?:mark\s*)?\d+", ""),
    (r"\b(\d+)\s*mins?\b", r"\1 minutes"), (r"\b(\d+)\s*hrs?\b", r"\1 hours"), (r"\b(\d+)\s*secs?\b", r"\1 seconds"),
    (r"(^|[.!?]\s+)Tip\b", r"\1Put"), (r"\btip (the|in|into|it|them|everything|all)\b", r"put \1"), (r"\bTip (the|in|into|it|them|everything|all)\b", r"Put \1"),
    (r"\bwhizz(?:ing)?\b", "blend"), (r"\bWhizz\b", "Blend"), (r"\bblitz\b", "blend"), (r"\bBlitz\b", "Blend"), (r"\bhob\b", "stove"), (r"\bfrying pan\b", "skillet"),
    (r"\bbaking parchment\b|\bbaking paper\b", "parchment paper"), (r"\bclingfilm\b", "plastic wrap"), (r"\bgriddle pan\b", "grill pan"), (r"\btin\b", "mould"), (r"\btins\b", "moulds"),
    (r"\bslow cooker\b", "crockpot"), (r"\bair[- ]fryer\b", "air fryer"), (r"\bspring onions?\b", "scallions"), (r"\bcourgettes?\b", "zucchini"), (r"\baubergines?\b", "eggplant"),
    (r"\bcaster sugar\b", "sugar"), (r"\btomato pur[ée]e\b", "tomato paste"), (r"\bpassata\b", "tomato sauce"), (r"\bdouble cream\b", "heavy cream"), (r"\bplain flour\b", "flour"),
    (r"\bmince\b", "ground meat"), (r"\bknead\b", "work the dough"), (r"\bKnead\b", "Work the dough"), (r"\bseason\b(?! with)", "add salt and pepper"), (r"\bSeason\b(?! with)", "Add salt and pepper"),
    (r"(\d{3})\s*°?\s*F\b", lambda m: "%d°C" % (round((int(m.group(1)) - 32) * 5 / 9 / 5) * 5)),
]
POST = [
    (r"\byogourts?\b", "yaourt"), (r"\bc\. à thé\b", "c. à café"), (r"\bcuillères? à thé\b", "cuillère à café"), (r"\bpoudre à pâte\b", "levure chimique"),
    (r"\bfarine auto[- ]?(?:élevée|levante|levée)\b", "farine avec levure incorporée"), (r"\bsucre de ricin\b", "sucre en poudre"), (r"\bcuisinière lente\b|\bmijoteuse lente\b|\bcrockpot\b|\bcrock-pot\b", "mijoteuse"),
    (r"\bfriteuse (?:à |d')air\b|\bfriteuse aérienne\b|\bfriteuse à l'air\b", "air fryer"), (r"\bfour à ventilateur\b|\bfour ventilé\b|\bventilateur\b", "chaleur tournante"),
    (r"\bétains?\b", "moule"), (r"\bpapier (?:de )?parchemin\b|\bparchemin de cuisson\b|\bpapier parchemin\b", "papier cuisson"), (r"\bpellicule plastique\b|\bfilm plastique\b", "film alimentaire"),
    (r"\bAstuce[zr]?\b", "Versez"), (r"\bastuce[zr]?\b", "versez"), (r"\bAgenouill\w*\b", "Pétrissez"), (r"\bagenouill\w*\b", "pétrissez"),
    (r"\boignons? de printemps\b", "oignons nouveaux"), (r"\bpoivre noir fraîchement (?:fissuré|craqué)\b", "poivre noir du moulin"), (r"\bfissurés?\b", "concassé"),
    (r"\btomates hachées\b", "tomates concassées"), (r"\bcrème double\b|\bdouble crème\b", "crème entière"), (r"\bcrème simple\b", "crème liquide"), (r"\bcubes? de stock\b", "cube de bouillon"),
    (r"\bstock de (poulet|légumes|bœuf)\b", r"bouillon de \1"), (r"\bfromage tendre\b", "fromage frais"), (r"\bpâtisserie (filo|feuilletée)\b", r"pâte \1"), (r"\bpâtisserie\b", "pâte"),
    (r"\bcoriandre fraîche fraîche\b", "coriandre fraîche"), (r"\bcourgettes?\b", "courgette"), (r"\bpoêle à frire\b", "poêle"), (r"\bcuisinière\b", "feu"), (r"\bplaque de cuisson\b", "plaque du four"),
    (r"\bcasserole de cuisson\b", "plat à four"), (r"\bcuillère à soupe\b", "cuillère à soupe"), (r"(\d)\s?°C", r"\1 °C"), (r"\bsel et poivre\b", "sel et poivre"),
    (r"\bajouter du sel et du poivre\b", "saler et poivrer"), (r"\bAjouter du sel et du poivre\b", "Salez et poivrez"), (r"\btravailler la pâte\b", "pétrir la pâte"), (r"\bTravailler la pâte\b", "Pétrir la pâte"),
    (r"\bviande hachée de bœuf\b", "bœuf haché"), (r"\bmoulés?\b(?= (?:à|de) (?:gâteau|cake|tarte|muffins?))", "moule"),
]


def pre(s):
    s = unfrac(re.sub(r"<[^>]+>", " ", s or "")).replace("&amp;", "&").replace("&#39;", "'").replace("’", "'")
    for a, b in PRE:
        s = re.sub(a, b, s)
    return re.sub(r"\s+", " ", s).strip()


def post(s):
    for a, b in POST:
        s = re.sub(a, b, s)
    return re.sub(r"\s+([,.;:!?])", r"\1", re.sub(r"\s+", " ", s)).strip()


def step_fr(s):
    s = pre(s)
    if not s:
        return ""
    parts = re.split(r"(?<=[.!?])\s+(?=[A-Z])", s)
    return post(" ".join(mt(p) for p in parts if p.strip()))


def title_fr(t):
    t = pre(t).replace(" & ", " and ")
    t = re.sub(r"\s*\|.*$", "", t)  # « Recette | Slimming & Weight Watchers Friendly »
    t = re.sub(r"\s*[-–]\s*(?:slimming|weight watchers|ww).*$", "", t, flags=re.I)
    fr = post(mt(t)).strip(" .")
    return cap(fr)


CAT = [(r"dessert|baking|cake|treat|pudding|sweet", "dessert"), (r"snack|nibble", "encas"), (r"breakfast|brunch", "petit-déjeuner"),
       (r"side", "accompagnement"), (r"starter|appetizer|appetiser", "entrée"), (r"drink|cocktail|smoothie", "boisson"), (r"sauce|dressing|condiment", "sauce"),
       (r"main|dinner|lunch|supper|course", "plat principal"), (r"soup", "soupe"), (r"salad", "salade")]


def cat_fr(c):
    c = (c or "").lower()
    out = []
    for rx, fr in CAT:
        if re.search(rx, c) and fr not in out:
            out.append(fr)
    return ", ".join(out)


# ---------------------------------------------------------------- Gemini
PROMPT = """Tu traduis une recette anglaise en français de France, pour une appli de repas.
Règles :
- Titre : court (60 caractères au plus), naturel, comme un titre de recette française (« Curry de poulet au riz en une seule casserole », pas « Un pot de poulet et de riz curry »). Sans mention « slimming », « Weight Watchers », « easy » ni nom de marque.
- Ingrédients : une ligne par ingrédient, même ordre, même nombre de lignes, sans les notes ni les renvois (« see tip », « Note 1 »). Format « quantité unité Ingrédient, préparation » :
  « 400 g Tomates concassées », « 2 cs Huile d'olive », « 1 Oignon rouge, finement haché », « 2 gousses d'ail, écrasées ». Unités : g, kg, ml, l, cs, cc, pincée.
  Convertis en métrique : cups, oz, lb, fl oz, pints → g ou ml (arrondis à 5) ; tbsp → cs ; tsp → cc ; « 400g can » → « 400 g ». Ne change aucune quantité, n'invente rien.
  Noms courants en France : passata → coulis de tomate, tomato purée → concentré de tomate, double cream → crème entière, single cream → crème liquide, caster sugar → sucre en poudre,
  self-raising flour → farine avec levure incorporée, cornflour → fécule de maïs, spring onions → oignons nouveaux, coriander → coriandre, pepper (légume) → poivron, chilli → piment, mince → haché,
  stock → bouillon, rapeseed oil → huile de colza, kosher salt → sel, low calorie cooking spray → huile en spray.
- Étapes : même nombre d'étapes, impératif à la 2e personne du pluriel (« Faites chauffer… »), températures en °C (chaleur tournante entre parenthèses si donnée), durées en minutes. Pas de commentaire.
- Catégorie : traduis en quelques mots.
Réponds uniquement en JSON : {"title": "...", "ing": ["..."], "steps": ["..."], "cat": "..."}
Recette :
"""


GEM_STATE = {"off": False, "n": 0, "last": 0.0, "dead": set()}


def gemini(rec):
    """Gemini (offre gratuite) : on espace les appels ; quota épuisé ou clé refusée → plus d'appel pendant ce passage."""
    if not GEMINI_KEY or GEM_STATE["off"]:
        return None
    body = {"title": rec.get("title", ""), "ing": rec.get("ing", [])[:40], "steps": rec.get("steps", [])[:25], "cat": rec.get("cat", "")}
    payload = json.dumps({"contents": [{"parts": [{"text": PROMPT + json.dumps(body, ensure_ascii=False)}]}],
                          "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json",
                                                               "thinkingConfig": {"thinkingBudget": 0}}}).encode()  # sans « réflexion » : réponse en quelques secondes
    for mo in GEMINI_MODELS:
        if mo in GEM_STATE["dead"]:
            continue
        for attempt in range(2):
            wait = 4.0 - (time.time() - GEM_STATE["last"])
            if wait > 0:
                time.sleep(wait)
            GEM_STATE["last"] = time.time()
            try:
                req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{mo}:generateContent",
                                             data=payload, headers={"Content-Type": "application/json", "x-goog-api-key": GEMINI_KEY})
                with urllib.request.urlopen(req, timeout=45) as r:
                    j = json.loads(r.read().decode())
                txt = j["candidates"][0]["content"]["parts"][0]["text"]
                out = check(json.loads(txt), body, "gemini")
                if out:
                    GEM_STATE["n"] += 1
                    return out
                print(f"Gemini {mo} : réponse incomplète", file=sys.stderr)
                break
            except urllib.error.HTTPError as e:
                msg = ""
                try:
                    msg = e.read().decode()[:300]
                except Exception:
                    pass
                print(f"Gemini {mo} : HTTP {e.code} {msg}", file=sys.stderr)
                if e.code in (400, 401, 403):
                    GEM_STATE["off"] = True  # clé refusée
                    return None
                if e.code == 429:
                    if "per day" in msg.lower() or "perday" in msg.lower() or attempt:
                        GEM_STATE["dead"].add(mo)  # quota de ce modèle épuisé : modèle suivant
                        if len(GEM_STATE["dead"]) >= len(GEMINI_MODELS):
                            GEM_STATE["off"] = True
                        break
                    time.sleep(20)
                    continue
                if e.code in (500, 503):
                    time.sleep(5)
                    continue
                break
            except Exception as e:
                print(f"Gemini {mo} : {e!r}", file=sys.stderr)
                break
    return None


def check(o, body, engine):
    ing = [str(x).strip() for x in o.get("ing", []) if str(x).strip()]
    st = [str(x).strip() for x in o.get("steps", []) if str(x).strip()]
    if o.get("title") and len(ing) >= max(2, len(body["ing"]) - 2) and (st or not body["steps"]):
        return {"title": cap(str(o["title"]).strip()), "ing": ing, "steps": st, "cat": str(o.get("cat", "")), "engine": engine}
    return None


def github(rec):
    """GitHub Models : 15 requêtes par minute et environ 150 par jour avec le jeton de l'action."""
    if not GH_TOKEN or GH_STATE["off"]:
        return None
    body = {"title": rec.get("title", ""), "ing": rec.get("ing", [])[:40], "steps": rec.get("steps", [])[:25], "cat": rec.get("cat", "")}
    wait = 4.5 - (time.time() - GH_STATE["last"])
    if wait > 0:
        time.sleep(wait)
    for mo in GH_MODELS:
        payload = json.dumps({"model": mo, "temperature": 0.2, "response_format": {"type": "json_object"},
                              "messages": [{"role": "system", "content": PROMPT.split("Recette :")[0].strip()},
                                           {"role": "user", "content": "Recette :\n" + json.dumps(body, ensure_ascii=False)}]}).encode()
        for attempt in range(2):
            GH_STATE["last"] = time.time()
            try:
                req = urllib.request.Request("https://models.github.ai/inference/chat/completions", data=payload,
                                             headers={"Content-Type": "application/json", "Authorization": "Bearer " + GH_TOKEN, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=90) as r:
                    j = json.loads(r.read().decode())
                o = json.loads(j["choices"][0]["message"]["content"])
                out = check(o, body, "github")
                if out:
                    return out
                break
            except urllib.error.HTTPError as e:
                msg = ""
                try:
                    msg = e.read().decode()[:300]
                except Exception:
                    pass
                print(f"GitHub Models {mo} : {e.code} {msg}", file=sys.stderr)
                if e.code == 429:
                    if "day" in msg.lower() or "daily" in msg.lower() or attempt:
                        GH_STATE["off"] = True  # quota du jour atteint : on reprendra au prochain passage
                        return None
                    time.sleep(30); continue
                if e.code in (401, 403):
                    GH_STATE["off"] = True
                    return None
                break  # modèle indisponible : on essaie le suivant
            except Exception as e:
                print(f"GitHub Models {mo} : {e!r}", file=sys.stderr)
                time.sleep(3)
                continue
    return None


def argos_rec(rec):
    ing = [x for x in (ing_line(l) for l in rec.get("ing", [])[:40]) if x]
    steps = [x for x in (step_fr(s) for s in rec.get("steps", [])[:25]) if x]
    return {"title": title_fr(rec.get("title", "")), "ing": ing, "steps": steps, "cat": cat_fr(rec.get("cat", "")), "engine": "argos"}


def main():
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            rec = json.loads(line)
        except Exception:
            continue
        out = None
        want = rec.get("engine") or os.environ.get("TRANSLATE_ENGINE", "")
        try:
            if want in ("", "gemini", "llm"):
                out = gemini(rec)
            if out is None and want in ("", "github", "llm"):
                out = github(rec)
            if out:
                out["cat"] = cat_fr(rec.get("cat", "")) or out.get("cat", "")
            if out is None and (want == "argos" or (not want and os.environ.get("TRANSLATE_FALLBACK") == "argos")):
                out = argos_rec(rec)
        except Exception as e:
            print("traduction impossible : " + repr(e), file=sys.stderr)
            out = None
        res = {"id": rec.get("id")}
        if out:
            res.update(out)
        else:
            res["error"] = 1
        sys.stdout.write(json.dumps(res, ensure_ascii=False) + "\n")
        sys.stdout.flush()


if __name__ == "__main__":
    main()
