// Runs only inside the disposable container-smoke fixture, not a live HA host.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
const mode=process.argv[2];assert.ok(['prepare','restored'].includes(mode));
const prefix='/api/hassio_ingress/'+'a'.repeat(32);
const socketPath='/run/ha-opendesign-paseo/bridge.sock';
const checkpoint='/data/opendesign/paseo-smoke.json';
const request=(body)=>new Promise((resolve,reject)=>{
 const req=http.request({socketPath,path:'/api/paseo-bridge',method:body?'POST':'GET',headers:{
  Host:'ha.fixture.test','X-OD-HA-Peer':'172.30.32.2','X-Remote-User-Id':'b'.repeat(32),'X-Ingress-Path':prefix,
  ...(body?{Origin:'https://ha.fixture.test',Referer:`https://ha.fixture.test${prefix}/paseo/setup/`,'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'}:{}),
 }},res=>{let text='';res.on('data',b=>text+=b);res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(text)});}catch{reject(Error('non-JSON bridge response'));}});});req.on('error',reject);req.setTimeout(15000,()=>req.destroy(Error('bridge timeout')));req.end(body?JSON.stringify(body):undefined);
});
async function until(predicate){
 for(let n=0;n<180;n++){
  try{const res=await request();if(res.status===200&&predicate(res.body))return res.body;}catch{}
  await delay(1000);
 }
 throw Error('Paseo lifecycle did not settle within 180 seconds');
}
const native=async(method,route,body)=>{
 const res=await fetch('http://127.0.0.1:7456'+route,{method,headers:{'Content-Type':'application/json','Sec-Fetch-Site':'same-origin'},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
 return {status:res.status,body:await res.json()};
};
if(mode==='prepare'){
 const dto=await until(s=>s.desiredEnabled&&s.daemon?.reachable&&s.onboarding?.initialized);
 const socket=fs.statSync(socketPath);assert.equal(socket.uid,1001);assert.equal(socket.gid,1002);assert.equal(socket.mode&0o777,0o660);
 const listed=await native('GET','/api/mcp/servers');assert.equal(listed.status,200);
 const entry=listed.body.servers.find(row=>row.id==='woow-paseo');assert.ok(entry);assert.deepEqual(entry.args,['/opt/opendesign-paseo/bin/mcp.mjs']);
 // A stale expected value must not overwrite the bridge's MCP registration.
 assert.equal((await native('PUT','/api/mcp/servers/woow-paseo',{server:entry,expected:null})).status,409);
 assert.deepEqual((await native('GET','/api/mcp/servers')).body.servers,listed.body.servers);
 fs.writeFileSync(checkpoint,JSON.stringify({projectId:dto.onboarding.projectId,conversationId:dto.onboarding.conversationId}),{mode:0o600});
 assert.equal((await request({action:'disable'})).status,202);
 await until(s=>s.desiredEnabled===false&&!s.daemon?.running&&s.operation?.status!=='running');
 console.log('Paseo smoke: native onboarding/CAS, managed start/stop, socket ownership passed');
}else{
 const expected=JSON.parse(fs.readFileSync(checkpoint));
 const dto=await until(s=>s.pluginInstalled&&s.desiredEnabled===false);
 assert.equal(dto.daemon?.running,false);assert.equal(dto.onboarding.projectId,expected.projectId);assert.equal(dto.onboarding.conversationId,expected.conversationId);
 const projects=await native('GET','/api/projects');assert.equal(projects.status,200);
 assert.equal(projects.body.projects.filter(p=>p.metadata?.woowPaseoInstallation).length,1);
 console.log('Paseo smoke: manual stop and onboarding identity survive volume restore/restart');
}
