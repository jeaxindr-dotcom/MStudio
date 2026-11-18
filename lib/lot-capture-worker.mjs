import {parentPort, workerData} from 'node:worker_threads';
import {once} from 'node:events';
import {captureLot} from './lot-captures.mjs';
import {releaseCaptureWorkspace} from './lot-capture-workspace.mjs';
import {readJsonStrict} from './episode.mjs';
import {closeCode} from './frames.mjs';

const {project, lot, file} = workerData;
const current = () => readJsonStrict(file, null)?.captureState?.id === lot.captureState.id;
const publish = () => parentPort.postMessage({
  captures: lot.edits.map(e => e.captures), state: lot.captureState,
});
try {
  if (current()) await captureLot(project, lot, publish, text => parentPort.postMessage({log: text}), current);
} finally {
  // The owner persists the last progress message before we remove inputs
  // needed for recovery. Large directories are cleaned off the HTTP thread.
  const reply = once(parentPort, 'message');
  parentPort.postMessage({finished: true});
  const [release] = await reply;
  await closeCode();
  if (release) releaseCaptureWorkspace(project, lot.captureState.id);
  parentPort.close();
}
