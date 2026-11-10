import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import {saveLotUpdates,lotMarkdown} from '../lib/lots.mjs';

const dir=fs.mkdtempSync(path.join(os.tmpdir(),'coulisses-long08-lots-'));
const p={kind:'remotion',ep:'Ptest',EP:dir,REVUE:dir,LOTS:dir,REPLIES:path.join(dir,'replies.json'),remotionDir:dir,remotion:{composition:'Long08'},target:'"test"',title:'Essai',coulisses:path.join(dir,'essai.coulisses'),project:{video:{file:'absent.mp4'}}};
const verdict = name=>({skills:{checked:33,updates:[{name,repo:'studio',why:'new'}],unknown:[]},errors:[],agent:{id:'codex',name:'Codex'},remotion:null,projectSkill:null,todo:false});
let ok=0; const pass=name=>{ok++;console.log('✓ '+name);};
try{
  const file=(n,ext)=>path.join(dir,String(n).padStart(3,'0')+'.'+ext);
  function record(n,u){
    const lot={lot:n,episode:'Ptest',kind:'remotion',title:'Essai',language:'fr',sentAt:'2026-01-01',agent:u.agent,updatesPending:true,captureState:{id:'gen-'+n,status:'ready'},fps:25,size:[640,360],edits:[]};
    fs.writeFileSync(file(n,'json'),JSON.stringify(lot));saveLotUpdates(p,n,lot.captureState.id,u);return fs.readFileSync(file(n,'md'),'utf8');
  }
  const one=record(1,verdict('Motion'));
  assert.match(one,/Aperçu du code/);assert.doesNotMatch(one,/export du \?/);pass('Le lot sans export identifie explicitement la source code');
  assert.match(one,/## Mises à jour/);assert.doesNotMatch(record(2,verdict('Motion')),/## Mises à jour/);assert.match(record(3,verdict('Nouvelle compétence')),/## Mises à jour/);
  const stored=JSON.parse(fs.readFileSync(file(2,'json')));assert.equal(stored.updates.skills.updates[0].name,'Motion');pass('Une même liste de mises à jour reste consultable et ne se répète pas dans le lot suivant');
  assert.match(lotMarkdown(p,stored,'en'),/Live code preview/);pass('Le libellé de source est traduit en anglais');
  console.log(ok+' ok, 0 ko');
}finally{if(path.dirname(dir)===os.tmpdir())fs.rmSync(dir,{recursive:true,force:true});}
