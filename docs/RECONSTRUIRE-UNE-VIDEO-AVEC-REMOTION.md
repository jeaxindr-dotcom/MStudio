# Reconstruire une vidéo dans MStudio

Dans la bibliothèque, **Découper en plans** et **Reconstruire en Remotion** répondent à deux besoins différents. Le premier conserve l’image filmée et permet d’en changer le montage ; le second crée une scène Remotion qui ne lit pas le MP4 source.

## Reconstruction par l’agent

1. Clique sur **Reconstruire en Remotion**. Choisis un MP4 local et nomme le projet.
2. **Codex CLI · automatique** démarre une nouvelle session de ton Codex CLI connecté, distincte de ton chat de revue. Des planches d’images de la vidéo sont envoyées à cet agent. **Mon agent · lui remettre le dossier** prépare les mêmes références sans lancer Codex ; copie la consigne dans le chat de ton choix, puis clique sur **Vérifier et rendre**. Laisse MStudio ouvert pendant la tâche.
3. MStudio mesure le format, la cadence, la durée et les coupes, extrait des images datées et, si la vidéo contient du son, décode le mixage dans un fichier audio séparé. L’agent observe les références et décrit les scènes, calques, couleurs, tracés et animations.
4. MStudio vérifie le document de calques et rassemble uniquement le modèle validé, les composants React et la piste son facultative dans le projet de rendu. Les captures, planches, consignes et le MP4 source ne deviennent pas des calques. Les composants du projet n’utilisent pas Internet au rendu.
5. Le logiciel exporte le film et compare un échantillon d’images avec les références. En mode automatique, il peut demander une correction à l’agent et conserver le meilleur des deux rendus. La bibliothèque indique les limites de la reproduction. Le rapport technique est dans `reconstruction.json`.

Le résultat est un nouveau dossier avec un fichier `.coulisses`, `src/layers.json` pour les textes, formes et images clés, et `src/Scene.tsx` pour le dessin Remotion. Chaque calque apparaît aussi dans la timeline. Pour vérifier l’indépendance d’un projet, mets le MP4 source de côté et relance `npm run render` depuis le projet. Pour vérifier son éditabilité, change par exemple la couleur d’un tracé dans `src/layers.json` et exporte de nouveau.

La fidélité varie avec le sujet, la cadence et le détail des éléments. Des courbes ou du lettrage peuvent être approximatifs, et un score calculé sur des images échantillonnées ne garantit pas un mouvement identique à chaque instant. Les modèles 3D, polices propriétaires, captures cachées par d’autres objets et pistes son séparées ne se déduisent pas d’un film aplati. Une reconstruction de graphisme n’est pas une régénération photoréaliste.

## Découpage en plans

1. Clique sur **Découper en plans**, choisis la vidéo et lance l’analyse. Tu peux scinder, fusionner, déplacer les plans ou changer leurs bornes.
2. Le mode propose aussi du texte natif, une lecture OCR et l’isolation d’une zone de l’image. La source reste présente sous ces interventions.
3. **Créer le projet Remotion** enregistre le montage. **Modifier le montage** reprend ensuite les réglages depuis la fiche du projet. Le montage et les références au média se trouvent dans `src/montage.json` et `reverse.json`.

Dans les deux modes, les bornes sont des numéros d’images. La fin est exclue : un plan de 217 à 269 contient 52 images.
