// La comparaison des skills parcourt leurs fichiers de façon synchrone. Elle
// s’exécute ici pour laisser le serveur accepter un autre lot pendant ce temps.
import { parentPort, workerData } from 'node:worker_threads';
import { checkUpdates } from './updates.mjs';

const { project, agent, fresh } = workerData;
parentPort.postMessage(await checkUpdates(project, { agent, fresh }));
