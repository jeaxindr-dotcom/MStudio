# Envoi des notes de Coulisses · 7 novembre 2026

Branche `envoi-astra`, issue de `935ce39`. Le délai d’envoi est mesuré entre le début du POST `/api/send` et la lecture de sa réponse JSON. À cet instant, la demande Markdown et les vingt notes sont sur disque et livrables à `studio-cli wait`. Le délai de la dernière image part du même POST et s’arrête lorsque le JSON du lot annonce tous les fichiers attendus.

## Où partait le temps

Le journal installé et les anciens JSON d’E29 ont été consultés en lecture seule. Le lot 4 a pris 184 s pour sept notes, avec huit rendus Remotion, six incrustations et six zooms. Le lot 6 a pris 149 s pour six notes, avec sept rendus, trois incrustations et trois zooms. Une plage ajoute un rendu à son extrémité. Un repère ajoute deux appels FFmpeg appliqués à la même image. Les photos jointes, les états de mise en scène et les fils de discussion ne déclenchent aucun rendu supplémentaire.

Deux frames ont été profilées sur une copie instrumentée d’E29, à 1920 × 1080 avec Remotion 4.0.535. Les durées proviennent des appels du SDK et de compteurs autour du chargement des ressources dans la copie de la scène. Les mesures de montage incluent les textures et les attentes de Remotion. Les sous-phases se recouvrent et ne doivent pas être additionnées au total.

| Temps mesuré | Image 16 027 | Image 42 487 |
|---|---:|---:|
| Bundle froid | 12,446 s | Réutilisé |
| Ouverture de Chrome | 0,431 s | Réutilisé |
| Sélection de la composition | 1,109 s | Réutilisée |
| Création de l’onglet de capture | 0,065 s | 0,122 s |
| Navigation et préparation de la page | 0,442 s | 0,800 s |
| Montage et recherche de l’image | 30,518 s | 50,377 s |
| Dont décors / accessoires / personnages | 3,928 / 12,792 / 10,083 s | 7,816 / 23,000 / 17,210 s |
| Lecture des pixels et production du JPEG | 0,148 s | 0,170 s |
| Appel complet à `renderStill` | 31,501 s | 51,704 s |
| Total du premier appel, préparation comprise | 45,514 s | 51,724 s |

Chaque onglet a chargé 438 ressources distinctes. Le profil ne sépare pas décodage, construction CPU et transfert GPU. Sur l’image 42 487 déjà rendue, FFprobe a pris 0,417 s, l’incrustation d’un repère 0,521 s et le zoom 0,678 s. Le chemin historique traitait les notes l’une après l’autre dans le POST. Sur ces deux appels isolés, aucune attente derrière un autre rendu n’explique le temps de montage.

Le bac synthétique utilise vingt notes en mode « Code actuel », une scène avec un délai de montage de 200 ms, seize positions de début et quatre plages qui finissent à la même image. L’ancienne version a effectué 24 captures pour 17 positions distinctes. Le POST a pris **34,190 s**. La totalité des JPEG était visible à **34,191 s**. Le journal situe environ 13 s dans le bundle et 18 s entre sa disponibilité et la publication du lot.

## Livraison et fabrication des images

1. Le POST conserve l’ordre des notes, leurs fils, repères, cibles, calques de dessin, pièces jointes, paramètres d’étalonnage et consignes de mise en scène. Il prépare les entrées du travail puis publie le Markdown avant le JSON, par remplacement atomique de chaque fichier. Le numéro de lot et l’identité de sa génération permettent de distinguer renvoi et nouvelle demande.
2. L’agent reçoit immédiatement la demande habituelle. La commande `studio-cli images <cible> <lot>` affiche progressivement les chemins réellement publiés, y compris si l’agent a déjà pris le lot. Les accusés de lecture des réponses continuent de suivre leur protocole propre. La carte indique le nombre de notes dont les captures ont été traitées et signale les erreurs.
3. Les sources du moteur, les entrées déclarées et les props sont figées pour le lot. Les médias volumineux et les dépendances partagés font l’objet d’un inventaire de versions. Le contrôle avant publication vérifie leur identité et leurs métadonnées. Sur Windows, une lecture groupée des répertoires évite un appel système indépendant pour chacun des quelque 35 700 fichiers de la copie d’E29. Le MP4 ou proxy sélectionné est conservé par lien physique lorsque le système de fichiers le permet.
4. Les débuts et fins identiques sont rendus une seule fois par source. En Remotion récent, les numéros distincts et triés passent à `renderFrames` sur une seule page, en JPEG qualité 90. Les anciens SDK gardent le rendu individuel des seules positions demandées. La capture, le contrôle des sources et la production des dessins peuvent avancer simultanément. L’ordre éditorial du lot reste celui de la file d’envoi. Les mises à jour des logiciels et des skills sont vérifiées en arrière-plan et leur verdict rejoint le lot et sa modale.
5. Les entrées persistées permettent de reprendre après une fermeture du studio. Chaque publication relit la génération du lot. Les dessins et les zooms sont calculés à partir des pixels de la version envoyée, avec les coordonnées d’origine de la composition. Les fichiers utilisables restent disponibles même si une autre capture échoue.

Sur les deux images profilées, un seul appel à `renderFrames` a pris 74,490 s, contre 83,205 s cumulées dans les appels à `renderStill`. La seconde image groupée a pris 1,676 s de montage/recherche et 0,509 s de capture. Les deux JPEG sont identiques octet pour octet à leurs références individuelles. La charge de la machine a varié entre les deux parcours, notamment à l’ouverture de Chrome.

Une capture du Player demanderait de certifier l’image affichée, sa définition, la version du code et l’absence d’éléments de sélection. Elle ne couvrirait qu’un des deux instants d’une plage. Le rendu par positions couvre aussi les notes déjà posées. Le choix d’une seule page limite la concurrence GPU sur le poste de travail. Le cache des JPEG est limité à un envoi et à sa reprise. Une réutilisation entre lots demanderait de certifier les mêmes dépendances et médias.

## Mesures de livraison

| Bac Remotion sans MP4, 20 notes | Réponse HTTP | Toutes les captures annoncées |
|---|---:|---:|
| Version installée `935ce39`, exécutée dans le worktree | 34,190 s | 34,191 s |
| Premier passage corrigé | 0,380 s | 14,493 s |
| Dernier passage corrigé | **0,220 s** | **8,417 s** |

Le même test HTTP part d’un studio neuf avec un bundle froid. Il vérifie vingt JPEG de début et quatre JPEG de fin, y compris les frames partagées entre notes. Il échoue si le POST prend trois secondes ou plus, ou si le lot attend ses images. Le dernier passage a réussi les deux assertions. Les temps de calcul sur le poste peuvent varier entre deux essais.

Une itération intermédiaire a donné 11,481 s pour l’accusé et 82,294 s jusqu’à l’état terminal. Cet essai a révélé un second chemin lent pour les clients qui omettent les dimensions du POST. Le serveur y appelait la construction complète des métadonnées du studio, avec inspection du GPU et des exports. Il lit maintenant uniquement le format. Le bouton fournit directement la cadence et les dimensions. L’état « prêt » est publié dès que les dernières captures ont été validées, avant la fermeture de Chrome.

Sur une copie de travail d’E29 sans MP4, le studio publie l’aperçu avant le test. Un vrai `studio-cli wait` surveille le bac au moment du POST. Vingt notes synthétiques couvrent les images 128 à 42 487, avec un intervalle finissant à 16 027 et un dessin à 42 487.

| Copie d’E29, vingt notes | Réponse HTTP | Lot imprimé par `wait` | Premier JPEG | Dernier des 23 JPEG | Fin du suivi CLI |
|---|---:|---:|---:|---:|---:|
| Premier passage intégré | 1,987 s | 3,261 s | 98,336 s | 124,253 s | 124,273 s |
| Dernier passage intégré | **0,360 s** | **1,410 s** | **28,262 s** | **32,998 s** | **33,346 s** |

L’attente du premier montage domine encore la fabrication. Les deux essais correspondent à des états différents du poste. Leur différence de temps ne permet pas de chiffrer l’effet propre du réglage audio.

Les vingt JPEG principaux avaient des empreintes distinctes. L’image de fin 16 027 et l’image de la note à 16 027 étaient identiques. Le dessin et le zoom recomposés indépendamment depuis le JPEG livré étaient identiques octet pour octet aux dérivés du lot. Le rectangle de recadrage était de 480 × 270 pixels, d’origine (402, 396).

Les deux passages de vingt positions ont livré les mêmes empreintes aux deux positions témoins. Ils présentaient de légers écarts avec les captures individuelles. L’image 16 027 atteignait 71,43 dB de PSNR selon la mesure FFmpeg, contre 38,84 dB pour l’image précédente comparée à ce même témoin. Sur 2 073 600 pixels, l’écart dépassait dix niveaux sur un canal RVB pour deux pixels à 16 027 et sept à 42 487. Le profil à deux positions, distinct de cette mesure intégrée, avait produit des JPEG identiques.

## Commits et régressions

| Commit | Défaut couvert | Vérification |
|---|---|---|
| `49ed1a5` | Le bouton restait en préparation et la carte ignorait la progression. | `lot-capture-ui` échouait sur les deux cas. Les deux passent avec le libellé d’envoi et les états de capture indépendants du statut de l’agent. |
| `1522577` | Un agent ayant reçu le premier Markdown ne découvrait pas les images suivantes. | `lot-images-cli` avait quatre échecs sur la base. Les quatre cas passent, dont l’ancien format, l’expiration et l’échec partiel. |
| `e75ab2f` | Une page par image et des rendus répétés aux positions partagées. | Les cinq cas de `lot-frame-list` vérifient les numéros rendus, les bornes et les anciens moteurs. Le profil E29 compare aussi les vrais pixels. |
| `b3900dd` | Une vérification de mises à jour à froid bloquait l’accusé. | Les trois cas initiaux de `lot-updates` échouaient sur la base. Ils passent avec une vérification volontairement suspendue, une reprise et une modale qui reçoit son verdict. |
| `34ea693` | Un travail différé pouvait relire le nouveau code ou le nouveau film. | Le module de gel était absent sur la base. Sept cas contrôlent les sources figées, les props, une modification pendant la copie, le remplacement du MP4 et les médias modifiés à taille et date conservées. |
| `c22496f` | Les parcours E03 et certains ports de test dépendaient des valeurs par défaut de la machine. | Les tests de bout en bout ciblent explicitement le bac et le moteur copiés. `speed-envois` a passé ses huit contrôles. |
| `062a7ac` | Les captures précédaient la publication, les calques vivaient dans le POST et un JPEG pouvait être réutilisé après la fin du film. | Le benchmark échouait à 34,190 s. `lot-capture-recovery` coupe le processus après publication, renvoie la même requête puis remplace le film et supprime les notes et le calque d’origine. La reprise retrouve les pixels, le zoom et la fin de plage. Le second cas refuse la frame hors film. |
| `82a4ce6` | Le rafraîchissement de la modale dépendait du mauvais cycle d’affichage. | Les huit contrôles de première publication et les dix-sept contrôles de transaction de l’aperçu passent. |
| `894a563` | Un arrêt brutal pouvait laisser un cache orphelin ou deux processus pouvaient reprendre le même lot. | Les trois tests de `lot-capture-workspace` échouaient avant prise en charge. Ils passent avec contrôle du propriétaire, des processus encore actifs et des jonctions. |
| `1d2cb84` | Le lanceur ne comptabilisait pas les nouveaux tests Node ni la performance. | Les suites sont enregistrées. Le lanceur reconnaît les résultats de `node:test` et conserve les comptes des suites historiques. |
| `cbe9af4` | Le test de ciblage confondait le nom compilé du composant avec l’identité de Hazel. Le test de la fenêtre de version lisait son contenu après une temporisation fixe. | Le lot du bac contient bien le composant `Actor2` avec la clé `hazel`. Le test vérifie l’objet métier et attend le contenu effectif de la fenêtre de version. |
| `0f34233` | Le mode groupé de Remotion pouvait préparer les pistes audio pour des images muettes. | Le test de `muted` échouait avec la valeur par défaut du SDK. Les cinq tests du moteur passent avec le même comportement audio que `renderStill`. |
| `8d9eb6d` | Un chemin externe de métadonnées pouvait empêcher une capture même si le rendu n’en avait pas besoin. | Le cas échouait sur le chemin externe. Le module privé ne dépend plus des modules de timeline et d’aperçu pour un rendu d’image. |
| `61bc8e7` | Une reprise dont le propriétaire est illisible pouvait laisser le CLI en attente. | Le test observait l’état « en préparation ». Il observe maintenant une erreur explicite et le dossier reste protégé. Les quatre tests de propriété et de reprise passent. |
| `a57b474` | Les tests de carte lisaient l’état avant le prochain sondage du studio. | Le manifeste confirmait l’annulation malgré l’échec du test. Les assertions attendent désormais la carte du lot concerné. Les parcours `e2e` et `i18n` passent intégralement pour leurs contrôles exécutés. |
| `3bb1363` | Un MP4 remplacé pendant l’envoi pouvait entrer en contradiction avec la référence conservée dans le lot. | Le cas ciblé échouait avant correction. La vidéo est figée en premier puis son identité annoncée est vérifiée. Les cinq contrôles de l’espace de travail passent. |
| `064ae1a` | La copie d’une entrée Remotion déclarée hors projet pouvait perdre son graphe d’imports. | Trois nouvelles régressions échouaient auparavant. Onze tests de sources passent, ainsi que cinq tests du cache des bundles et cinq tests de rendu des positions. |

## Résultats des suites

Les derniers journaux de 21 suites totalisent **303 contrôles réussis et zéro échec**. Ils incluent `send-lots` (13), `speed-envois` (8), `e2e-agent` (11), `e2e` (41), `notes-safety` (11), la livraison des réponses et des pièces jointes avec et sans navigateur (77), ainsi que `i18n` (78). Deux contrôles supplémentaires du binaire Windows ont été sautés car `Coulisses.exe` est absent de ce worktree.

Un essai supplémentaire d’internationalisation avait brièvement chevauché un parcours de navigateur. Il a été interrompu avant sa phase E03 puis rejoué sur le bac et le moteur copiés. Les chronométrages de livraison ci-dessus ont chacun été réalisés sans autre rendu de test en parallèle. Les traces locales disponibles dans ce worktree sont sous `.cache/mesure-envoi`, `.cache/mesure-e29` et `.cache/run-all`.

## Rejouer les vérifications

Le test de performance construit son propre projet synthétique sans MP4 sous `.cache`. Il utilise les dépendances disponibles sur le poste et isole les écritures de Webpack, le dossier temporaire, les réglages et la bibliothèque de médias. Le lanceur vérifie l’activité des studios par des GET avant chaque suite. Les tests de navigateur utilisent un Chrome muet et les parcours E03 peuvent cibler explicitement le bac et le moteur copiés.

```powershell
node tests/run-all.mjs --only envoi-performance,lot-capture-recovery
node tests/run-all.mjs --only lot-images-cli,lot-frame-list,lot-sources,lot-capture-ui,lot-updates,lot-capture-workspace
node tests/run-all.mjs --only send-lots,speed-envois,notes-safety,reply-delivery,reply-delivery-ui,reply-images,reply-delivery-browser
$env:STUDIO_SANDBOX = (Resolve-Path '.cache/bac-envois/07_Episodes').Path
$env:COULISSES_TEST_ENGINE_COPY = (Resolve-Path '.cache/mesure-e29/moteur').Path
node tests/run-all.mjs --only e2e-agent,e2e,i18n
```

## Limites

La version de référence est celle de l’envoi. Les notes historiques ne conservent pas les pixels du Player à l’instant de leur création. Les médias et dépendances trop gros pour être dupliqués instantanément sont certifiés avant publication. Si l’un d’eux change pendant un rendu, les fichiers déjà validés restent utilisables et la carte ainsi que le CLI signalent les captures affectées. Une modification dans une partie inutilisée d’une bibliothèque partagée peut déclencher ce contrôle.

Le temps de la première image dépend encore du bundle et du montage 3D. La file de rendu conserve une seule page active par travail. Une entrée Remotion réellement extérieure au projet demande exceptionnellement de compiler son bundle avant l’accusé pour conserver la résolution de ses imports. Cette préparation peut dépasser quelques secondes. Les bibliothèques très nombreuses et les volumes réseau peuvent également allonger le contrôle des sources.

## Résumé à transmettre

Les notes partent dès que le lot est enregistré. Sur la copie de « Just One More » sans MP4, vingt notes ont été envoyées en 0,36 à 1,99 s et reçues par l’agent en 1,41 à 3,26 s. Les 23 images sont arrivées en arrière-plan en 33 s à 2 min 04 s selon l’essai. La carte affiche leur progression. Le dessin, le zoom et la fin de plage ont été vérifiés. La correction est prête à relire sur `envoi-astra`.
