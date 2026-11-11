import assert from 'node:assert/strict';
import test from 'node:test';
import http from 'node:http';
import {once} from 'node:events';
import {createUpdateController, relayUpdate, updateAction, updateRequestStatus} from '../lib/app-update-api.mjs';

test('The editor and the library expose the supported local update actions', () => {
  const req = {method:'POST', headers:{host:'127.0.0.1:4510',origin:'http://127.0.0.1:4510','content-type':'application/json'}};
  assert.equal(updateAction('/api/app-update/check'), 'check');
  assert.equal(updateAction('/api/app-update/defer'), 'defer');
  assert.equal(updateAction('/api/app-update/cancel'), 'cancel');
  assert.equal(updateAction('/api/app-update/run'), undefined);
  assert.equal(updateRequestStatus(req, 'install'), 200);
  assert.equal(updateRequestStatus(req, 'state'), 405);
  for (const headers of [
    {origin:'null'}, {origin:'http://localhost:4520'}, {host:'remote.example'},
    {'sec-fetch-site':'cross-site'}, {'content-type':'text/plain'},
  ]) assert.notEqual(updateRequestStatus({...req, headers:{...req.headers,...headers}}, 'install'), 200);
});

test('A studio contacts its library and supplies its own project for the restart', async t => {
  const seen = [];
  const hub = http.createServer((req,res) => {
    seen.push([req.method, req.url, req.headers['content-type']]);
    res.writeHead(409, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'work is active'}));
  });
  hub.listen(0,'127.0.0.1'); await once(hub,'listening'); t.after(() => hub.close());
  const url = 'http://127.0.0.1:' + hub.address().port;
  const reply = await relayUpdate(url, 'install','P1234abcd');
  assert.equal(reply.status,409); assert.equal(reply.data.error,'work is active');
  assert.deepEqual(seen,[['POST','/api/app-update/install?ep=P1234abcd','application/json']]);
  await assert.rejects(relayUpdate('https://example.org', 'state'));
});

function fixture() {
  const base = {status:'ready',currentVersion:'0.2.3',latestVersion:'0.2.4'}, file = {version:'0.2.4'};
  const data = {receipt:null, busy:false, attempts:0, checked:0};
  const controller = createUpdateController({
    updates:{state:() => base,check:async () => {data.checked++; return base;},verifiedInstaller:async () => file},
    installation:() => data.receipt,
    checkIdle:async () => {if (data.busy) throw Error('render active');},
    schedule:async (value,id,action) => {assert.equal(value,file); data.attempts++; data.id=id; data.receipt={status:action==='defer'?'scheduled':'installing',version:value.version};},
    cancel:async () => {data.receipt=null;},
  });
  return {controller,data};
}

test('An active render postpones installation while leaving the verified download available', async () => {
  const {controller,data}=fixture(); data.busy=true;
  await assert.rejects(controller.run('install'),/render active/); assert.equal(data.attempts,0);
  assert.equal((await controller.run('state')).status,'ready');
  data.busy=false; await Promise.all([controller.run('install','E01'),controller.run('install','E01')]);
  assert.equal(data.attempts,1); assert.equal(data.id,'E01');
  assert.equal((await controller.run('install','E02')).status,'installing'); assert.equal(data.attempts,1);
});

test('A deferred install survives a check, can be cancelled and can be promoted to an immediate restart', async () => {
  const {controller,data} = fixture(); data.busy=true;
  assert.equal((await controller.run('defer','E01')).status,'scheduled');
  assert.equal((await controller.run('check')).status,'scheduled'); assert.equal(data.checked,0);
  await assert.rejects(controller.run('install','E01'),/render active/);
  assert.equal((await controller.run('cancel')).status,'ready');
  await Promise.all([controller.run('defer','E02'),controller.run('cancel')]);
  assert.equal((await controller.run('state')).status,'ready');
  data.busy=false;
  await Promise.all([controller.run('defer','E02'),controller.run('install','E02')]);
  assert.equal((await controller.run('cancel')).status,'installing'); assert.equal(data.id,'E02');
});

test('A cancelled installation is visible after restart and the user can retry', async () => {
  const {controller,data} = fixture();
  data.receipt={status:'error',version:'0.2.4',error:'installation cancelled'};
  assert.equal((await controller.run('state')).errorStage,'install');
  assert.equal((await controller.run('check')).status,'ready');
  assert.equal((await controller.run('state')).status,'ready'); assert.equal(data.checked,1);
  await controller.run('install'); assert.equal(data.attempts,1);
  data.receipt={status:'error',version:'0.2.4',error:'installation cancelled'};
  assert.equal((await controller.run('state')).error,'installation cancelled');
});

test('A restarted hub can promote a saved choice offline and retain its project', async () => {
  const file={path:'verified-setup.exe',version:'2.0.0',sha256:'a'.repeat(64),projectId:'E03'};
  const controller=createUpdateController({
    updates:{state:()=>({status:'idle',currentVersion:'1.0.0'}),verifiedInstaller:()=>assert.fail('download state was lost on restart')},
    installation:()=>({status:'scheduled',version:file.version}),scheduledInstaller:()=>file,
    checkIdle:async()=>{},schedule:async (saved,id,mode)=>{
      assert.equal(saved,file); assert.equal(id,'E03'); assert.equal(mode,'install');
      return {status:'installing',version:saved.version};
    },
  });
  assert.equal((await controller.run('install')).status,'installing');
});
