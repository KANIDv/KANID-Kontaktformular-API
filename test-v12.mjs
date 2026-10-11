import w from './worker.mjs' /* cp worker.js worker.mjs */;
const sent=[]; globalThis.fetch = async (u,o)=>{ if(String(u).includes('turnstile')) return new Response(JSON.stringify({success:false,'error-codes':['invalid-input-response']})); sent.push(JSON.parse(o.body)); return new Response('{}',{status:200}); };
async function t(label, pfad, fields, env, headers={}){
  sent.length=0;
  const fd=new FormData(); for(const [k,v] of Object.entries(fields)) fd.append(k,v);
  const r=await w.fetch(new Request('https://x.workers.dev'+pfad,{method:'POST',body:fd,headers:{Accept:'application/json','CF-Connecting-IP':'203.0.113.'+Math.floor(Math.random()*200),Origin:'https://kanid.de',...headers}}),env);
  const body=await r.text();
  console.log('\n##',label, r.status, body.slice(0,300), '| mails:',sent.map(m=>m.to.join(',')+' | '+m.subject).join(' ; '));
  return {r, body, sent: sent.slice()};
}
const prod={RESEND_API_KEY:'x', TURNSTILE_SECRET:'y'};
const stag={STAGING:'1', TURNSTILE_SECRET:'y'};
const wr={name:'Max Muster',email:'max@muster.de',vertrag:'waren',kennung:'VK-20261009-1234',datum:'09.10.2026',nachricht:'Bitte Rückzahlung auf PayPal.'};
let x=await t('widerruf prod', '/widerruf', wr, prod);
console.log(x.sent[0].text); console.log('---KUNDE---'); console.log(x.sent[1].text);
await t('widerruf ohne kennung+datum', '/widerruf', {...wr,kennung:'',datum:''}, prod);
await t('widerruf falscher vertrag', '/widerruf', {...wr,vertrag:'x'}, prod);
await t('widerruf fremde origin', '/widerruf', wr, prod, {Origin:'https://evil.example'});
await t('widerruf honeypot', '/widerruf', {...wr,'bot-field':'x'}, prod);
x=await t('widerruf link in nachricht', '/widerruf', {...wr,nachricht:'see https://spam.example'}, prod);
console.log('kunde enthaelt link?', x.sent[1].text.includes('spam.example'), 'intern?', x.sent[0].text.includes('spam.example'));
x=await t('widerruf staging dryrun', '/widerruf', {...wr,vertrag:'dienstleistung'}, stag, {Origin:'https://home-5020882524.app-ionos.space'});
const j=JSON.parse(x.body); console.log('weiter', j.weiter, 'dry', j.staging_trockenlauf.map(m=>m.an+' <- '+m.urspruenglich_an+' | '+m.betreff));
// non-json redirect
const fd=new FormData(); for(const [k,v] of Object.entries(wr)) fd.append(k,v);
let r=await w.fetch(new Request('https://x/widerruf',{method:'POST',body:fd,headers:{Origin:'https://kanid.de'}}),prod); console.log('\nredirect', r.status, r.headers.get('location'));
// contact
const base={name:'Max Muster',firma:'Privat',email:'max@muster.de',art:'einzelprojekt',message:'Guten Tag, ich habe eine Produktidee und möchte Phase 1 beauftragen.'};
x=await t('kontakt prod turnstile fehlt -> verworfen', '/', {...base,vorzeitig:'ja'}, prod);
x=await t('kontakt staging vorzeitig', '/', {...base,vorzeitig:'ja',vorzeitig_fassung:'ENTWURF-2026-10',vorzeitig_text:'Ich verlange ausdrücklich ...'}, {...stag, RESEND_API_KEY:'x'}, {Origin:'https://home-5020882524.app-ionos.space'});
console.log(x.sent[0].text.split('\n').filter(l=>/Vorzeitig|Zeitpunkt|Wortlaut/.test(l)).join('\n')); console.log('kunde:', x.sent[1].text.includes('ausdrücklich verlangt'), x.sent[1].html.includes('ausdrücklich verlangt'));
x=await t('kontakt staging ohne vorzeitig', '/', base, {...stag, RESEND_API_KEY:'x'});
console.log(x.sent[0].text.split('\n').filter(l=>/Vorzeitig/.test(l)).join('\n'), 'kunde:', x.sent[1].text.includes('ausdrücklich verlangt'));
fd.set('name','x'); r=await w.fetch(new Request('https://x/',{method:'POST',body:(()=>{const f=new FormData();for(const [k,v] of Object.entries(base)) f.append(k,v);return f})(),headers:{Origin:'https://home-5020882524.app-ionos.space'}}),{...stag,RESEND_API_KEY:'x'}); console.log('kontakt staging redirect', r.status, r.headers.get('location'));
r=await w.fetch(new Request('https://x/',{method:'GET'}),prod); console.log(await r.text());
