# Intégrer un projet Remotion dans MStudio

Ce guide s’adresse à l’agent ou au développeur qui adapte un projet Remotion pour sa revue dans MStudio.

## Aperçu et revue

MStudio ouvre le projet avant son premier export.
- il ouvre le fichier `.coulisses` du run ;
- il compile le projet Remotion et joue la composition en direct ;
- sa timeline sait ce qu'est chaque morceau (« ce motion graphic, de telle image à telle image ») ;
- l'utilisateur annote, et ses notes partent à l'agent en lots.

Le projet expose une liste de compositions et une fonction qui décrit leurs pistes.

## Ce qu'il faut livrer (liste de contrôle)

1. **Un projet Remotion** avec `package.json`, `node_modules`, `src/index.ts` (`registerRoot`) et `public/`. Plusieurs compositions peuvent partager le même projet.
2. **Une composition par run**, avec un id stable, par exemple `Exemple-01`. Les données du run (plans, textes, minutage) sont **dans le projet**, en `src/runs/<run>.ts` ou en JSON importé par le code. L'aperçu de MStudio se recharge à chaque enregistrement.
3. **`src/coulisses.ts`** : la liste des compositions. C'est la source unique : le `Root` déclare ses `<Composition>` à partir d'elle.
4. **`src/coulisses-timeline.ts`** : la timeline du run, en images, pour Node. Ce sont des données seulement : aucun composant importé.
5. **`data-coulisses="<nom lisible>"`** sur les éléments visibles qui comptent (titres, cartes, schémas, sous-parties d'un motion graphic). Une note épinglée dessus les nomme d'elle-même.
6. **Les médias par `staticFile()`**, depuis `public/<run>/`. Ce dossier peut être une jonction vers les médias du run : `mklink /J`, sans copier.
7. **Le fichier `.coulisses`, créé au début du run**, par la commande `projet creer`, voir plus bas.
8. **`projet verifier` doit dire « PROJET CONFORME »**, et l'image de vérification qu'il produit doit être regardée.

## Les deux modules du contrat

### `src/coulisses.ts` (le navigateur : l'aperçu en direct)

```ts
import { MonRun } from './MonRun';
import { RUN, totalFrames } from './runs/episode-01';
export const compositions = [
  { id: 'Exemple-01', component: MonRun, fps: 30, width: 1920, height: 1080,
    durationInFrames: (props) => totalFrames(), defaultProps: { run: 'episode-01' } },
];
```

- `durationInFrames` : un nombre, ou une fonction des props. Un Short est en `width: 1080, height: 1920`.
- `Root.tsx` : `compositions.map((c) => <Composition key={c.id} id={c.id} component={c.component} fps={c.fps} width={c.width} height={c.height} durationInFrames={…} defaultProps={c.defaultProps} />)`. Si le Root et ce module divergent, `projet verifier` le signale.

### `src/coulisses-timeline.ts` (Node : la timeline)

```ts
import { RUN, totalFrames } from './runs/episode-01';
export function timeline(compositionId: string, props: unknown) {
  return {
    fps: 30, durationInFrames: totalFrames(),
    pistes: [
      { id: 'chap', nom: 'Chapitres', type: 'band',  clips: [{ de: 0, a: 1177, label: 'acte0-hook' }] },
      { id: 'V1',   nom: 'Plans',     type: 'video', clips: [{ de: 0, a: 489, label: 'plan s00-01 · titre', fichier: 'src/scenes/S0001.tsx', ref: 's00-01' }] },
      { id: 'V2',   nom: 'Présentateur', type: 'video', clips: [{ de: 0, a: 489, label: 'présentateur acte0', fichier: 'public/<run>/06-metahuman/acte0.mp4', debut: 0 }] },
      { id: 'A1',   nom: 'Voix',      type: 'audio', clips: [{ de: 0, a: 19034, label: 'voix du film', son: '<run>/voix.wav' }] },
    ],
  };
}
```

- **Une piste** : `id`, `nom` lisible, `type` = `video` (clips visibles), `audio` (forme d'onde) ou `band` (chapitres ou sections).
- **Un clip** :
  - `de` et `a`, en images de la composition, avec `a` exclu ;
  - `label` lisible ;
  - `fichier` : **le fichier à corriger** pour ce morceau (composant, média) ;
  - `ref` : l'id du segment ou de la scène ;
  - `son` : le chemin dans `public/`, pour la forme d'onde **et le son de relecture** (voir plus bas) ;
  - `debut` : le décalage en images dans le média source ;
  - `volume` (facultatif, linéaire, 1 par défaut) : le niveau auquel la composition joue ce clip son, s'il n'est pas 1 ;
  - `off: true` pour un clip désactivé.
- **Le son de relecture** : pendant la relecture du code en direct, MStudio ne laisse plus l'aperçu jouer le son. Il mixe lui-même, avec ffmpeg, les clips des pistes `audio` (`son`, `de`/`a`, `debut`, `volume`) en une seule piste, que la page joue comme horloge ; l'aperçu, muet, la suit (le son ne se coupe plus quand l'image rame). Les pistes `audio` doivent donc dire **tout** le son du film, à ses niveaux : des stems pré-mixés (voix, musique, bruitages) suffisent. Un niveau qui varie dans le temps (ducking, fondus) doit être dans le fichier lui-même. Sans piste `audio`, l'aperçu garde son propre son. Désactivable : `"reviewSound": false` dans `%LOCALAPPDATA%\MStudio\settings.json`.
- **Deux clips simultanés sur la même piste** : faire deux pistes.
- **Tout ce qui est visible à l'écran doit apparaître dans la timeline**, là où il est visible.
- **La timeline se calcule à partir des mêmes données que la composition**, jamais à la main : elles ne peuvent pas diverger.

## Le fichier `.coulisses` du run

Il se crée au **début du run**, dans le dossier du run, par la commande de MStudio. Les valeurs passent par un fichier JSON UTF-8, jamais par du texte français dans le shell :

```json
{ "dossier": "C:\\Videos\\Exemple\\episode-01",
  "titre": "Épisode 1", "chaine": "Exemple", "format": "16:9",
  "projet": "C:\\Videos\\Exemple\\remotion", "composition": "Exemple-01",
  "props": { "run": "episode-01" }, "export": "07-renders" }
```

```
node "<CLI>" projet creer --depuis spec.json        → imprime le chemin du fichier « Épisode 1.coulisses »
node "<CLI>" projet verifier "<…>.coulisses"         → « PROJET CONFORME », ou la liste des problèmes à corriger
```

- **Les champs facultatifs** : `entree` (`src/index.ts` par défaut), `module` (`src/coulisses.ts`), `timeline` (`src/coulisses-timeline.ts`), `motif` (`\.mp4$`, pour reconnaître l'export dans le dossier `export`).
- **`projet verifier`** :
  - lance la timeline sous Node ;
  - lit la composition ;
  - compile l'aperçu comme MStudio ;
  - fait rendre une image par Remotion, l'image de vérification, dans `<run>\revue\images\`. **La regarder.**

  `--rapide` saute ce rendu. `--images 1700,8000` rend les images choisies au lieu de celle du milieu (utile quand le milieu tombe dans une vidéo plein cadre).
- Dans PowerShell, utilise le Node et la CLI installés avec MStudio. Remplace `node "<CLI>"` par `& "$env:LOCALAPPDATA\Programs\MStudio\runtime\node.exe" "$env:LOCALAPPDATA\Programs\MStudio\studio-cli.mjs"`. Tu peux importer le `.coulisses` depuis la bibliothèque.
- **Les notes de l'utilisateur** vont dans `<run>\revue\` (`notes.json`, `lots\`…). Le protocole de l'agent est `AGENT.md`, à côté de `studio-cli.mjs` : les commandes prennent le chemin `"<run>\revue"` à la place de « E03 ».

## Les règles Remotion pour que l'aperçu soit exactement l'export

- **Tout se déduit de l'image** : `useCurrentFrame()`, `useVideoConfig()`, `interpolate`, `spring`.
  - Jamais `Math.random()` : utiliser `random(seed)` de `remotion`.
  - Jamais `Date.now()`.
  - Jamais d'animation CSS ni de `setTimeout` pour animer.
- **GSAP existant** : créer la timeline **en pause**, puis `tl.seek(frame / fps)` dans un `useLayoutEffect` à chaque image. Ne jamais la laisser jouer seule.
- **Aucun accès à `window` ou `document` au chargement d'un fichier**, seulement dans les composants et leurs effets : MStudio importe les modules sous Node.
- **Vidéos** : `<OffthreadVideo>`, en H.264 MP4, ou en WebM VP9 pour une vidéo avec transparence.
  - **Le QuickTime Animation (`qtrle`, les `.mov` de calques) ne se lit pas dans Chrome**. Le convertir une fois : `ffmpeg -i calque.mov -c:v libvpx-vp9 -pix_fmt yuva420p -b:v 0 -crf 30 calque.webm`.
- **Sons** : `<Audio>` avec `volume` (constante ou fonction de l'image). La voix, la musique et les bruitages peuvent rester des fichiers pré-mixés.
- **Identifiant de composition**. Utilise des lettres, des chiffres et des tirets, par exemple `Exemple-01`.
- **Polices** : `@remotion/google-fonts`, ou une police locale chargée avant le rendu (`@remotion/fonts`).
- **Versions** : `remotion` et tous les `@remotion/*` à **la même version exacte**, sans `^`. **`@remotion/player` doit être installé**, c'est l'aperçu de MStudio. Les montées de version se font avec `npx remotion upgrade`, puis une vérification.
- **Skills officiels conseillés** : `npx skills add remotion-dev/skills -g` (`remotion-best-practices`, `remotion-upgrade`…).
- **Rendu** :
  - `npx remotion render src/index.ts <composition> "<run>\07-renders\master.mp4" --props=<fichier.json> --browser-executable="C:/Program Files/Google/Chrome/Application/chrome.exe" --gl=angle`, puis la finition sonore habituelle de la chaîne (loudnorm) ;
  - Si Windows renvoie `EPERM symlink` en copiant une jonction dans `public/`, utilise un dossier public de préparation contenant les médias réels ou un paquet qui pointe vers le dossier `public/` du projet.
  - **seulement sur ordre de l'utilisateur**, une fois la revue faite dans MStudio ;
  - l'export doit arriver dans le dossier `export` du `.coulisses`. MStudio le charge seul, et propose « Comparer avant / après ».

## Le script d'export : ce que MStudio lance quand l'utilisateur clique « Exporter »

Le projet Remotion de la chaîne fournit **`scripts\coulisses-rendu.mjs`**. MStudio le lance depuis le dossier du projet, quand l'utilisateur le demande, jamais seul :

```
node scripts/coulisses-rendu.mjs --composition <id> --props "<props.json>" --dossier "<dossier export du .coulisses>" --titre "<titre>"
```

Le script :
- **prépare le paquet** sans casser les jonctions de `public\` (voir plus haut), avec `--browser-executable="C:/Program Files/Google/Chrome/Application/chrome.exe" --gl=angle` ;
- **rend puis finit** comme la chaîne le fait : volume, 4K, assemblage des morceaux… ;
- **choisit le nom** du fichier final selon les habitudes de la chaîne (`master.mp4`, `<Nom>-1080p.mp4`, `shortNN_4k_final.mp4`…) ;
- **écrit d'abord dans un fichier `….tmp.mp4`**, puis le renomme à la fin : MStudio ne charge jamais un fichier en cours d'écriture ;
- **s'il remplace un fichier qui existe déjà** (même nom que le dernier export, que MStudio est peut-être en train de montrer) : il affiche d'abord `COULISSES REMPLACE "<chemin>"`, puis réessaie le renommage pendant au moins 60 s. MStudio lâche alors la vidéo (Windows refuse de remplacer un fichier ouvert), et la reprend à la fin de l'export ;
- **affiche son avancement** sur la sortie standard, une ligne par étape ou par pour cent : `COULISSES PROGRES <0-100> <étape>` (ex. `COULISSES PROGRES 42 rendu`), et finit par **`COULISSES FIN "<chemin du fichier final>"`** ;
- **dit ses images**, s'il les connaît : `COULISSES IMAGES <faites> <total>` (ex. `COULISSES IMAGES 12345 34019`), au plus une fois par seconde pendant le rendu. MStudio en tire le compteur « image 12 345 / 34 019 » et le temps restant ; sans elle, il montre le pourcentage ;
- **sort avec le code 0** s'il a réussi, sinon avec un autre code et l'erreur sur la sortie d'erreur ;
- **peut être arrêté à tout moment** : MStudio arrête alors le processus et ses enfants. Il ne reste qu'un `….tmp.mp4`, jamais un faux fichier final.

Le `.coulisses` doit avoir un dossier `export`, sinon MStudio ne propose pas l'export.

**Les qualités** : MStudio montre dans tous les projets le même choix, **1080p | 4K**, et le même bouton « Lancer le rendu ». `node scripts/coulisses-rendu.mjs --options` affiche sur la sortie standard un tableau JSON, puis sort aussitôt, sans rien rendre :

```json
[{ "id": "1080p", "label": "1080p" }, { "id": "4k", "label": "4K" }]
```

MStudio transmet l’identifiant choisi avec `--qualite <id>`. Un identifiant `1080p` ou `4k` indique explicitement la résolution. Les libellés peuvent la préciser pour des identifiants comme `final`. Ajoute `scope: "full"` pour un film complet ou `scope: "excerpt"` pour un extrait. Si le script ignore `--options`, le studio garde l’export par défaut.

**Le GPU, par défaut.** MStudio dit au script quel encodeur utiliser, par la variable d'environnement **`COULISSES_GPU`** : `nvenc` (Windows, Linux : une carte NVIDIA dont l'encodeur marche vraiment, vérifié par un encodage d'essai), `videotoolbox` (macOS), ou `cpu` (pas d'encodeur GPU, ou l'utilisateur a décoché « Encoder avec le GPU »). Un script qui ne la connaît pas l'ignore et fait comme avant. Quand elle n'est pas `cpu`, le script devrait :

- encoder avec le GPU : `renderMedia({ …, hardwareAcceleration: 'required', videoBitrate })`, **sans `crf`** (un encodeur matériel ne l'accepte pas) ; débit conseillé 50 Mb/s en 4K, 20 Mb/s en 1080p ;
- capturer les images en **JPEG qualité 100** (`imageFormat: 'jpeg', jpegQuality: 100`) plutôt qu'en PNG : la compression PNG de chaque image coûte plus que tout le reste ;
- en 4K, rendre **6 morceaux à la fois**, chacun dans son propre Chrome ;
- s'il encode encore lui-même avec ffmpeg (une 1080p tirée de la 4K…), utiliser `-c:v h264_nvenc -b:v 20M` ;
- **repasser au processeur** (`crf`, x264) si le GPU échoue, et le dire dans son journal.

## Un plan 3D rendu à part et monté en vidéo (« utilise »)

Un plan 3D peut avoir son propre projet Remotion et son propre descripteur. Pour le retoucher depuis le montage qui utilise son MP4, relie les deux projets.

1. **Le projet de la scène** a lui aussi `src/coulisses.ts` (ses compositions de plans) et, si possible, `src/coulisses-timeline.ts`. S'il utilise React Three Fiber, MStudio lui donne d'office la mise en scène 3D du Théâtre : choisir un objet, le déplacer, le tourner, et la caméra libre.
2. **Chaque plan a son `.coulisses`**, dans son propre dossier (un dossier `revue` par plan), avec en plus :

```json
"utilise": [{ "coulisses": "C:\\Videos\\Exemple\\episode-01\\episode-01.coulisses", "fichier": "public/episode-01/plans/scene.mp4" }]
```

`coulisses` est le `.coulisses` du run qui montre ce plan. `fichier` est le fichier du plan dans ce run, tel que sa timeline le donne, relatif au projet Remotion du run.

3. **Dans le studio du run**, sur ce clip, un bouton « Ouvrir la scène 3D » ouvre le plan dans son propre studio. Le plan doit être importé dans l'accueil de MStudio.
4. **Le lot du plan** dit à l'agent où va son rendu : refaire le rendu de la composition et remplacer ce fichier du run, même nom, même format et même durée.

`studio-cli.mjs projet creer --depuis spec.json` accepte `utilise` dans le fichier JSON.

## Comment migrer sans tout refaire d'un coup

1. **D'abord le montage**. Le montage Resolve devient une composition Remotion : une `<Sequence>` par clip, une piste par calque.
   - **Les morceaux déjà rendus en MP4** (scènes, présentateur MetaHuman) y entrent tels quels, en `<OffthreadVideo>`. MStudio peut alors relire le montage complet tout de suite.
   - **Les effets de Resolve** se refont en CSS : flou et assombrissement par `filter: blur() brightness()` sur une copie du calque, cadre 9:16 par la mise en page.
2. **Ensuite, scène par scène**, les scènes HTML ou HyperFrames deviennent des composants React. Ce sont elles qui gagnent le plus : corrigées dans le code, elles se revoient aussitôt dans MStudio, sans rendu.
3. **La timeline** reprend les pistes que l'utilisateur connaît (chapitres, plans, présentateur, calques, voix, musique, bruitages), calculées depuis les mêmes données que la composition.

## En attendant Remotion : le `.coulisses` « vidéo »

Un projet vidéo peut être ouvert dès que son rendu est disponible. Le descripteur indique où trouver le fichier et la timeline, et le dossier `revue/` conserve les notes.

```
node "<CLI>" projet creer --moteur video --dossier "<run>" --nom <slug> --titre "<titre ou slug>" --chaine "<chaîne>" --format 16:9
     --export "07-publish|06-video/renders" --motif "-(1080p|2160p)\.mp4$" --plan 06-video/coulisses-timeline.json
```

- **`--export`** : le ou les dossiers où arrivent les rendus du run, séparés par `|`, relatifs au run (`..\<dossier voisin>` est permis). **`--motif`** : l'expression qui reconnaît un rendu à relire, pas les brouillons ni les morceaux. `--profondeur N` cherche aussi dans N niveaux de sous-dossiers (0 par défaut). MStudio prend le plus récent, **jamais un fichier écrit il y a moins de 20 s** (un rendu en cours).
- **`--plan`** (facultatif) : la timeline. Elle peut ne pas exister encore : elle apparaît quand le pipeline l'écrit. Deux formats :
  - le format de MStudio, en images : `{ "fps": 30, "durationInFrames": N, "pistes": [{ "id", "nom", "type": "video|audio|band", "clips": [{ "de", "a", "label", "fichier" }] }] }` ;
  - le format de plan de montage avec `08-montage/plan-montage.json`.
- **`--nom`** fixe le nom du fichier (`<slug>.coulisses`). Relancer `projet creer` avec le même `--nom` **met à jour** le fichier (le titre connu plus tard, par exemple) : la date de création, l'export et le plan déjà écrits sont gardés.
- **Le jour du passage à Remotion** : `projet creer --nom <slug> --projet … --composition …` sur le même run transforme ce fichier en run Remotion, avec les mêmes notes. L'inverse est refusé.
- **Jamais bloquant** : si MStudio est absent ou trop ancien, le pipeline affiche un avis et continue.

## Essayer sur son propre projet

Dans la bibliothèque, crée un projet Remotion, puis utilise son dossier comme exemple. Tu y trouveras le descripteur `.coulisses`, `src/coulisses.ts`, `src/coulisses-timeline.ts`, le point d’entrée et le script d’export. Copie la commande de connexion depuis le panneau Agent pour vérifier cette installation.

## Ce qu'il ne faut pas faire

- **Écrire `revue\notes.json`** : il appartient à la page de MStudio. L'agent écrit seulement par `studio-cli.mjs` (`replies.json`).
- **Écrire la timeline à la main**, ou la laisser diverger de la composition.
- **Laisser un élément visible absent de la timeline**, ou un média hors de `public/`.
- **Rendre sans ordre de l'utilisateur.**
- **Mettre à jour Remotion ou les skills sans son accord** : MStudio vérifie ces mises à jour à chaque envoi, et l'agent les propose en QCM.
