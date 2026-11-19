import w from './worker.mjs' /* cp worker.js worker.mjs */;
const sent=[]; let resendStatus=200; globalThis.fetch = async (u,o)=>{ if(String(u).includes('turnstile')) return new Response(JSON.stringify({success:false,'error-codes':['invalid-input-response']})); sent.push(JSON.parse(o.body)); return new Response('{}',{status:resendStatus}); };
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
await t('widerruf teil ohne angabe', '/widerruf', {...wr,umfang:'teil'}, prod);
x=await t('widerruf teil + anschrift, ohne kennung', '/widerruf', {...wr,kennung:'',umfang:'teil',umfang_teil:'Halterung Typ B, 2 Stück',anschrift:'Musterweg 1, 70794 Filderstadt'}, prod);
console.log(x.sent[1].subject); console.log(x.sent[1].text.split('\n').slice(8,16).join('\n'));
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
x=await t('kontakt prod turnstile fehlt -> verworfen', '/', base, prod);
x=await t('kontakt staging', '/', base, {...stag, RESEND_API_KEY:'x'}, {Origin:'https://home-5020882524.app-ionos.space'});
console.log('vorzeitig-Reste?', /vorzeitig/i.test(x.sent.map(m=>m.text+(m.html||'')).join('')));
fd.set('name','x'); r=await w.fetch(new Request('https://x/',{method:'POST',body:(()=>{const f=new FormData();for(const [k,v] of Object.entries(base)) f.append(k,v);return f})(),headers:{Origin:'https://home-5020882524.app-ionos.space'}}),{...stag,RESEND_API_KEY:'x'}); console.log('kontakt staging redirect', r.status, r.headers.get('location'));
r=await w.fetch(new Request('https://x/',{method:'GET'}),prod); console.log(await r.text());

// ---- Sprache de/en -------------------------------------------------------
const fails=[];
function check(cond, msg){
  if(!cond){ fails.push(msg); console.error('FAIL', msg); }
  else console.log('ok', msg);
}
const enMsg='Hello, I have a product idea and would like to commission phase 1.';
const deMail=[
  'Guten Tag,',
  '',
  'vielen Dank für Ihre Nachricht an KANID. Sie ist bei uns eingegangen.',
  'Diese E-Mail bestätigt nur den Eingang — sie ist keine Auftragsbestätigung und kein Angebot.',
  '',
  'Wir antworten werktags innerhalb weniger Stunden.',
  '',
  'Falls Sie uns nicht geschrieben haben, können Sie diese E-Mail ignorieren.',
  '',
  'KANID UG (haftungsbeschränkt)',
  'Heinrich-Hertz-Str. 11',
  '70794 Filderstadt',
  'info@kanid.de · +49 1520 7921611',
].join('\n');
const enMail=[
  'Hello,',
  '',
  'thank you for your message to KANID. We have received it.',
  'This email only confirms receipt — it is not an order confirmation and not an offer.',
  '',
  'We reply on business days within a few hours.',
  '',
  'If you did not write to us, you can ignore this email.',
  '',
  'KANID UG (haftungsbeschränkt)',
  'Heinrich-Hertz-Str. 11',
  '70794 Filderstadt',
  'info@kanid.de · +49 1520 7921611',
].join('\n');
const envMail={...stag, RESEND_API_KEY:'x'};

let y=await t('de pflicht','/',{lang:'de'},prod);
let bj=JSON.parse(y.body);
check(y.r.status===422 && bj.meldung==='Bitte füllen Sie alle Pflichtfelder aus.' && !('_lang' in bj), 'de pflicht');
y=await t('en pflicht','/',{lang:'en'},prod);
bj=JSON.parse(y.body);
check(y.r.status===422 && bj.meldung==='Please fill in all required fields.', 'en pflicht');
y=await t('lang EN','/',{lang:'EN'},prod);
check(JSON.parse(y.body).meldung.startsWith('Please fill'), 'lang=EN');
y=await t('lang fr','/',{lang:'fr'},prod);
check(JSON.parse(y.body).meldung.startsWith('Bitte füllen'), 'lang=fr bleibt de');
y=await t('referer en','/',{},prod,{Referer:'https://kanid.de/en/contact/'});
check(JSON.parse(y.body).meldung.startsWith('Please fill'), 'referer /en/');
y=await t('referer /en','/',{},prod,{Referer:'https://kanid.de/en'});
check(JSON.parse(y.body).meldung.startsWith('Please fill'), 'referer /en');
y=await t('referer enterprise','/',{},prod,{Referer:'https://kanid.de/enterprise'});
check(JSON.parse(y.body).meldung.startsWith('Bitte füllen'), '/enterprise bleibt de');
y=await t('feld de schlaegt referer','/',{lang:'de'},prod,{Referer:'https://kanid.de/en/contact/'});
check(JSON.parse(y.body).meldung.startsWith('Bitte füllen'), 'feld de gewinnt');
// Origin mit Pfad ist kein Allowlist-Eintrag (weiterhin exakt https://kanid.de).
// Der Pfad liefert trotzdem die Sprache der Fehlermeldung.
y=await t('origin pfad','/',{},prod,{Origin:'https://kanid.de/en/contact/'});
check(y.r.status===403 && JSON.parse(y.body).meldung==='Invalid origin.', 'origin-pfad /en/ ist englisch, aber nicht erlaubt');
y=await t('en email','/',{...base,email:'keine-mail',lang:'en'},prod);
check(y.r.status===422 && JSON.parse(y.body).meldung==='Please enter a valid email address.', 'en email');
y=await t('de email','/',{...base,email:'keine-mail'},prod);
check(JSON.parse(y.body).meldung==='Bitte geben Sie eine gültige E-Mail-Adresse ein.', 'de email');

r=await w.fetch(new Request('https://x/',{method:'PUT',headers:{Accept:'application/json',Referer:'https://kanid.de/en/contact/'}}),prod);
bj=JSON.parse(await r.text());
check(r.status===405 && bj.meldung==='Only POST is allowed.', 'method en');
r=await w.fetch(new Request('https://x/',{method:'PUT',headers:{Accept:'application/json'}}),prod);
bj=JSON.parse(await r.text());
check(bj.meldung==='Nur POST ist erlaubt.', 'method de');
y=await t('origin en','/',{lang:'en'},prod,{Origin:'https://evil.example'});
check(y.r.status===403 && JSON.parse(y.body).meldung==='Invalid origin.', 'origin en');
y=await t('origin de','/',{},prod,{Origin:'https://evil.example'});
check(JSON.parse(y.body).meldung==='Ungültige Herkunft.', 'origin de');

const fdEn=new FormData(); fdEn.append('lang','en');
r=await w.fetch(new Request('https://x/',{method:'POST',body:fdEn,headers:{Origin:'https://kanid.de','CF-Connecting-IP':'198.51.100.10'}}),prod);
let html=await r.text();
check(r.status===422 && html.includes('lang="en"') && html.includes('Please fill in all required fields.') && html.includes('>Back<'), 'html en');
const fdDe=new FormData();
r=await w.fetch(new Request('https://x/',{method:'POST',body:fdDe,headers:{Origin:'https://kanid.de','CF-Connecting-IP':'198.51.100.11'}}),prod);
html=await r.text();
check(html.includes('lang="de"') && html.includes('Bitte füllen Sie alle Pflichtfelder aus.') && html.includes('>Zurück<') && !html.includes('lang="en"'), 'html de');

for(let i=0;i<5;i++) await t('rate de '+i,'/',{},prod,{'CF-Connecting-IP':'198.51.100.20'});
y=await t('rate de','/',{},prod,{'CF-Connecting-IP':'198.51.100.20'});
check(y.r.status===429 && JSON.parse(y.body).meldung==='Zu viele Nachrichten. Bitte in ein paar Minuten erneut versuchen.', 'rate de');
for(let i=0;i<5;i++) await t('rate en '+i,'/',{lang:'en'},prod,{'CF-Connecting-IP':'198.51.100.21'});
y=await t('rate en','/',{lang:'en'},prod,{'CF-Connecting-IP':'198.51.100.21'});
check(y.r.status===429 && JSON.parse(y.body).meldung==='Too many messages. Please try again in a few minutes.', 'rate en');

y=await t('mail de','/',base,envMail,{'CF-Connecting-IP':'198.51.100.30'});
bj=JSON.parse(y.body);
check(y.r.status===200 && bj.ok===true && bj.mail===true && bj.weiter==='https://kanid.de/danke' && !('_lang' in bj), 'de erfolg');
check(y.sent.length===2, 'de zwei mails');
check(y.sent[0].subject==='[TEST] [Projekt] Privat', 'intern betreff de');
check(y.sent[0].text.includes('Neue Nachricht über das Kontaktformular auf kanid.de') && y.sent[0].text.includes('Sprache: Deutsch'), 'intern deutsch');
check(y.sent[1].subject==='[TEST] Ihre Nachricht an KANID' && y.sent[1].text===deMail, 'kunde mail de');
check(y.sent[1].html.includes('<html lang="de">') && y.sent[1].html.includes('Wir haben Ihre Anfrage erhalten.'), 'kunde html de');

y=await t('mail en','/',{...base,lang:'en',message:enMsg},envMail,{'CF-Connecting-IP':'198.51.100.31'});
bj=JSON.parse(y.body);
check(bj.ok===true && bj.weiter==='https://kanid.de/en/thank-you/', 'en weiter');
check(y.sent[0].subject==='[TEST] [Projekt] Privat' && y.sent[0].text.includes('Sprache: Englisch') && y.sent[0].text.includes('Neue Nachricht über das Kontaktformular auf kanid.de'), 'intern bleibt deutsch');
check(y.sent[1].subject==='[TEST] Your message to KANID' && y.sent[1].text===enMail, 'kunde mail en');
check(y.sent[1].html.includes('<html lang="en">') && y.sent[1].html.includes('We have received your inquiry.') && !y.sent[1].html.includes('Wir haben Ihre Anfrage erhalten.'), 'kunde html en');
check(y.sent[1].to.join(',')==='info@kanid.de', 'empfaenger staging unveraendert');

resendStatus=500;
y=await t('mail fail en','/',{...base,lang:'en',message:enMsg},envMail,{'CF-Connecting-IP':'198.51.100.32'});
check(y.r.status===500 && JSON.parse(y.body).meldung==='The message could not be sent. Please write directly to info@kanid.de.', 'mail fail en');
y=await t('mail fail de','/',base,envMail,{'CF-Connecting-IP':'198.51.100.33'});
check(JSON.parse(y.body).meldung==='Die Nachricht konnte nicht versendet werden. Bitte schreiben Sie direkt an info@kanid.de.', 'mail fail de');
resendStatus=200;

let nIp=40;
async function ort(fields, headers={}){
  const fd=new FormData();
  for(const [k,v] of Object.entries(fields)) fd.append(k,v);
  const ip='198.51.100.'+(nIp++);
  const resp=await w.fetch(new Request('https://x/',{method:'POST',body:fd,headers:{Origin:'https://kanid.de','CF-Connecting-IP':ip,...headers}}),envMail);
  return resp.headers.get('location');
}
const enBase={...base,lang:'en',message:enMsg};
check(await ort(base)==='https://kanid.de/danke', 'redirect de');
check(await ort(enBase)==='https://kanid.de/en/thank-you/', 'redirect en');
check(await ort(base,{Referer:'https://kanid.de/en/contact/'})==='https://kanid.de/en/thank-you/', 'redirect referer');
check(await ort({...base,lang:'de'},{Referer:'https://kanid.de/en/contact/'})==='https://kanid.de/danke', 'redirect feld de');
check(await ort({...enBase,danke_url:'https://kanid.de/en/thank-you/?from=form'})==='https://kanid.de/en/thank-you/?from=form', 'danke_url query');
check(await ort({...enBase,danke_url:'https://www.kanid.de/thanks'})==='https://www.kanid.de/thanks', 'danke_url www');
check(await ort({...enBase,danke_url:'https://KANID.de/en/custom'})==='https://kanid.de/en/custom', 'danke_url host normalisiert');
check(await ort({...base,danke_url:'https://kanid.de/danke/'})==='https://kanid.de/danke/', 'danke_url de override');
for(const bad of ['https://evil.example/phish','https://kanid.de.evil.com/x','https://user:pass@kanid.de/en/thank-you/','http://kanid.de/en/thank-you/','https://evil.app-ionos.space/en/thank-you/','javascript:alert(1)','https://kanid.de@evil.com','https://kanid.de:444/en/thank-you/']){
  check(await ort({...enBase,danke_url:bad})==='https://kanid.de/en/thank-you/', 'danke_url abgelehnt '+bad);
}
check(await ort(base,{Origin:'https://home-5020882524.app-ionos.space'})==='https://home-5020882524.app-ionos.space/danke/', 'staging de');
check(await ort(enBase,{Origin:'https://home-5020882524.app-ionos.space'})==='https://home-5020882524.app-ionos.space/en/thank-you/', 'staging en');
check(await ort(enBase,{Origin:'https://www.kanid.de'})==='https://www.kanid.de/en/thank-you/', 'www en');
check(await ort({...base,'bot-field':'x'})==='https://kanid.de/danke', 'honeypot de');
check(await ort({...enBase,'bot-field':'x'})==='https://kanid.de/en/thank-you/', 'honeypot en');

r=await w.fetch(new Request('https://x/ping'),prod);
bj=JSON.parse(await r.text());
check(bj.version===14 && bj.ok===true, 'version 14');

if(fails.length){
  console.error('\n'+fails.length+' Sprache-Tests fehlgeschlagen');
  process.exit(1);
}
console.log('\nSprache-Tests ok');
