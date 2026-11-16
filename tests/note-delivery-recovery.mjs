// Actual delivery reconciliation functions, without a project, browser or render.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {test} from 'node:test';

const source = fs.readFileSync(new URL('../page/studio/05-agent.js', import.meta.url), 'utf8');
const start = source.indexOf('  let sending = false;'), end = source.indexOf('  function renderQueue()', start);
assert.ok(start >= 0 && end > start);
const code = source.slice(start, end);
const clone = x => JSON.parse(JSON.stringify(x));
const before = '2026-11-16T07:26:21.469Z', sent = '2026-11-16T07:34:31.000Z', after = '2026-11-16T07:35:00.001Z';
const note = (extra = {}) => ({id:'note1', draft:true, text:'Animate this element', frame:3120, end:null,
  updated:before, created:before, status:'done', statusAt:after, images:[{file:'images/mark.png'}],
  thread:[], at:{frame:3120,end:null,plan:'original'}, plan:'current', ...extra});
const lot = (extra = {}) => ({lot:1, sentAt:sent, kind:'edits', ids:['note1'], claude:{status:'done'}, ...extra});
function fixture(notes = [note()], lots = [lot()]) {
  let saves = 0;
  const c = vm.createContext({notes:clone(notes), STATUS:{lots:clone(lots)}, NOTES_OK:true,
    HIST:{back:[],fwd:[],last:JSON.stringify(notes)}, persist:()=>saves++, byId:id=>c.notes.find(n=>n.id===id)});
  vm.runInContext(code + '\nglobalThis.deliveryContent = deliveryContent;', c);
  return {c, saves:()=>saves};
}

test('A corrected published annotation leaves the queue without losing any content or reply', () => {
  const {c,saves} = fixture();
  const original = clone(c.notes[0]);
  c.REPLIES = {notes:{note1:{messages:[{text:'Corrected by the agent',at:after}],status:'done'}}};
  const replies = JSON.stringify(c.REPLIES);
  assert.equal(c.reconcilePublishedNotes(),true);
  assert.deepEqual(c.notes[0],{...original,draft:false,lot:1,sentAt:sent});
  assert.equal(JSON.stringify(c.REPLIES),replies);
  assert.equal(saves(),1);
  assert.equal(c.reconcilePublishedNotes(),false);
  assert.equal(saves(),1);
});

test('An agent reply and the fixed checkbox alone never prove publication', () => {
  const {c,saves} = fixture([note()],[]);
  c.REPLIES = {notes:{note1:{status:'done',messages:[{text:'Fixed'}]}}};
  assert.equal(c.reconcilePublishedNotes(),false);
  assert.equal(c.notes[0].draft,true);assert.equal(saves(),0);
});

test('Missing notes are not restored and unrelated drafts stay in the queue', () => {
  const {c} = fixture([note({id:'other'})]);
  assert.equal(c.reconcilePublishedNotes(),false);
  assert.equal(c.notes.length,1);assert.equal(c.notes[0].id,'other');
  c.notes=[];assert.equal(c.reconcilePublishedNotes(),false);assert.equal(c.notes.length,0);
});

test('A later edit, user reply, or malformed date keeps publication uncertain', () => {
  for (const extra of [{updated:after},{thread:[{text:'Another change',at:after}]},{updated:'invalid'},
    {updated:0},{updated:'2026-11-16T07:34:31.001Z'}]) {
    const {c} = fixture([note(extra)]);
    assert.equal(c.reconcilePublishedNotes(),false,JSON.stringify(extra));
    assert.equal(c.notes[0].draft,true);
  }
});

test('An explicit resend is not swallowed by the earlier lot, even with identical dates', () => {
  for (const extra of [{lot:1},{updated:sent,draftQueuedAt:sent},{lot:1,updated:after,draftQueuedAt:after}]) {
    const {c} = fixture([note(extra)]);
    assert.equal(c.reconcilePublishedNotes(),false);
    assert.equal(c.notes[0].draft,true);
  }
});

test('A new publication confirms a resend and removes its queue marker', () => {
  const {c} = fixture([note({lot:1,updated:after,draftQueuedAt:after})],
    [lot(),lot({lot:2,sentAt:'2026-11-16T07:36:00.125Z'})]);
  assert.equal(c.reconcilePublishedNotes(),true);
  assert.equal(c.notes[0].lot,2);assert.equal(c.notes[0].draft,false);
  assert.equal(c.notes[0].draftQueuedAt,undefined);
});

test('The latest matching publication wins; render requests and invalid lot records do not count', () => {
  const {c} = fixture([note()],[lot({lot:3,sentAt:after}),lot(),lot({lot:99,kind:'render',sentAt:after})]);
  assert.equal(c.reconcilePublishedNotes(),true);assert.equal(c.notes[0].lot,3);
  for (const invalid of [lot({sentAt:'invalid'}),lot({lot:0}),lot({lot:'1'}),lot({ids:[]}),lot({kind:'render'})]) {
    const f=fixture([note()],[invalid]);assert.equal(f.c.reconcilePublishedNotes(),false);
  }
});

test('Prompt requests use the same conservative recovery as annotations', () => {
  const {c} = fixture([note({kind:'prompt'})]);
  assert.equal(c.reconcilePublishedNotes(),true);assert.equal(c.notes[0].draft,false);
});

test('Undo and Redo keep the receipt without losing words or recreating deleted notes', () => {
  const {c} = fixture();
  const old = note({text:'Previous words'}), requeued = note({updated:after,lot:1,draftQueuedAt:after});
  c.HIST.back=[{type:'notes',state:JSON.stringify([old])},{type:'notes',state:'[]'},{type:'stage',state:'unrelated'}];
  c.HIST.fwd=[{type:'notes',state:JSON.stringify([requeued])}];
  assert.equal(c.reconcilePublishedNotes(),true);
  const recovered = JSON.parse(c.HIST.back[0].state)[0];
  assert.equal(recovered.text,'Previous words');assert.equal(recovered.draft,false);assert.equal(recovered.lot,1);
  assert.equal(c.HIST.back[1].state,'[]');assert.equal(c.HIST.back[2].state,'unrelated');
  assert.deepEqual(JSON.parse(c.HIST.fwd[0].state),[requeued]);
  assert.equal(JSON.parse(c.HIST.last)[0].draft,false);
});

test('Recovery waits until the current send has returned and notes are loaded', () => {
  const {c} = fixture();
  c.NOTES_OK=false;assert.equal(c.reconcilePublishedNotes(),false);
  c.NOTES_OK=true;vm.runInContext('sending=true',c);assert.equal(c.reconcilePublishedNotes(),false);
  vm.runInContext('sending=false',c);assert.equal(c.reconcilePublishedNotes(),true);
});

test('The direct response acknowledges unchanged content with its original publication time', () => {
  const {c} = fixture();
  const content=c.deliveryContent(c.notes[0]);
  assert.equal(c.confirmDelivery('note1',content,lot()),true);
  assert.equal(c.notes[0].draft,false);assert.equal(c.notes[0].sentAt,sent);
});

test('An edit made during sending stays queued after both the late response and a later poll', () => {
  const {c} = fixture();
  const content=c.deliveryContent(c.notes[0]);
  c.notes[0].text='New words written while sending';
  // Deliberately keep the same timestamp: content, not clock resolution, must protect this edit.
  assert.equal(c.confirmDelivery('note1',content,lot()),false);
  assert.equal(c.notes[0].draft,true);assert.equal(c.notes[0].lot,1);
  assert.equal(c.reconcilePublishedNotes(),false);
  assert.equal(c.notes[0].text,'New words written while sending');
});

test('Automatic remapping during sending keeps its new position and confirms the original request', () => {
  const {c} = fixture();
  const content=c.deliveryContent(c.notes[0]);
  Object.assign(c.notes[0],{frame:3450,end:3500,source:'video',plan:'new-plan',render:{size:100},
    context:{scene:'Moved scene'},previewReadiness:{frame:3450},followVersion:2});
  assert.equal(c.confirmDelivery('note1',content,lot()),true);
  assert.equal(c.notes[0].draft,false);
  assert.equal(c.notes[0].frame,3450);assert.equal(c.notes[0].end,3500);
  assert.equal(c.notes[0].source,'video');assert.equal(c.notes[0].plan,'new-plan');
  assert.equal(c.notes[0].context.scene,'Moved scene');
});

test('Manual positioning changes the anchor and remains queued, including notes without an anchor', () => {
  for (const anchored of [true,false]) {
    const {c}=fixture([note(anchored ? {} : {at:null})]);
    const content=c.deliveryContent(c.notes[0]);
    c.notes[0].frame=3450;c.notes[0].updated=after;
    if(anchored) c.notes[0].at={frame:3450,end:null,plan:'current'};
    assert.equal(c.confirmDelivery('note1',content,lot()),false);
    assert.equal(c.notes[0].draft,true);assert.equal(c.notes[0].frame,3450);
  }
});

test('A late send response never recreates a deleted note or overwrites a newer receipt', () => {
  const {c} = fixture();
  const content=c.deliveryContent(c.notes[0]);
  c.notes=[];assert.equal(c.confirmDelivery('note1',content,lot()),false);assert.equal(c.notes.length,0);
  c.notes=[note({draft:true,lot:3,text:'Newer content',sentAt:after})];
  assert.equal(c.confirmDelivery('note1',content,lot()),false);
  assert.equal(c.notes[0].lot,3);assert.equal(c.notes[0].sentAt,after);
});
