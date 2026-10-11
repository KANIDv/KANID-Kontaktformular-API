// Cloudflare Worker — in die Oberflaeche einfuegen:
// dash.cloudflare.com → Workers & Pages → kanid-kontakt → Edit code
//
// Secret: RESEND_API_KEY

const ERLAUBT = [
  'https://kanid.de',
  'https://www.kanid.de',
];

const ERLAUBT_SUFFIX = '.app-ionos.space';
const EMPFAENGER = 'info@kanid.de';
const DANKE = 'https://kanid.de/danke';

const ARTEN = {
  konstruktion: { tag: 'Retainer', label: 'Konstruktionskapazität' },
  einzelprojekt: { tag: 'Projekt', label: 'Einzelprojekt' },
  factory: { tag: 'Factory', label: 'Factory-Produkt' },
  sonstiges: { tag: 'Sonstiges', label: 'Sonstiges' },
};

const QUELLEN = new Set([
  'hero', 'starter', 'pro', 'enterprise', 'factory',
  'footer', 'blog', 'referenz',
]);

function originErlaubt(origin) {
  if (!origin) return true;
  if (ERLAUBT.includes(origin)) return true;
  try {
    const url = new URL(origin);
    return url.protocol === 'https:' && url.hostname.endsWith(ERLAUBT_SUFFIX);
  } catch {
    return false;
  }
}

function corsHeaders(origin) {
  const headers = {
    'Cache-Control': 'no-store',
    'X-Robots-Tag': 'noindex, nofollow',
  };
  if (origin && originErlaubt(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
    headers['Vary'] = 'Origin';
    headers['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    headers['Access-Control-Allow-Headers'] = 'Accept, Content-Type';
  }
  return headers;
}

function json(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(origin),
      'Content-Type': 'application/json; charset=UTF-8',
    },
  });
}

function willJson(request) {
  return (request.headers.get('Accept') || '').includes('application/json');
}

function antwort(request, data, status) {
  const origin = request.headers.get('Origin') || '';
  if (willJson(request) || request.method !== 'POST') {
    return json(data, status, origin);
  }
  if (data.ok) {
    return Response.redirect(DANKE, 303);
  }
  const text = data.meldung || 'Die Nachricht konnte nicht gesendet werden.';
  return new Response(
    `<!DOCTYPE html><html lang="de"><meta charset="UTF-8"><title>Fehler</title><p>${text}</p><p><a href="https://kanid.de/#kontakt">Zurück</a></p>`,
    { status, headers: { ...corsHeaders(origin), 'Content-Type': 'text/html; charset=UTF-8' } },
  );
}

function feld(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/[\r\n\0]/g, ' ').trim().slice(0, max);
}

// ---- Spamschutz (v10) ----------------------------------------------------
const MIN_SEKUNDEN = 4;
const RATE_MAX = 5;            // Nachrichten
const RATE_FENSTER_MS = 10 * 60 * 1000; // pro 10 Minuten und IP
const rateSpeicher = new Map(); // best effort: gilt nur je Worker-Isolate

const LINK_MUSTER = /(https?:\/\/|www\.|telegra\.ph|shorto\.link|bit\.ly|tinyurl\.|t\.me\/|myip\.|\b[a-z0-9-]{2,}\.(?:ph|link|ly|xyz|top|click|icu|ru|su)\b)/i;
const LOCK_MUSTER = /(promo ?code|jackpot|winner|win the|giveaway|bitcoin|crypto|casino|lottery|backlinks?|seo services?|rolls-royce|lamborghini|playstation|\$\s?\d)/i;
const DEUTSCH_MUSTER = /[äöüßÄÖÜ]|\b(und|der|die|das|ich|wir|sie|nicht|mit|für|fuer|bitte|ist|ein|eine|einen|zu|guten|hallo|danke|anfrage|grüße|gruesse|vielen|unser|unsere|wäre|haben|können)\b/i;

function clientIp(request) {
  return request.headers.get('CF-Connecting-IP') || '';
}

function ipKurz(ip) {
  if (!ip) return '';
  if (ip.includes(':')) return ip.split(':').slice(0, 3).join(':') + '::';
  return ip.split('.').slice(0, 3).join('.') + '.x';
}

function rateLimitUeberschritten(ip) {
  if (!ip) return false;
  const jetzt = Date.now();
  const liste = (rateSpeicher.get(ip) || []).filter((t) => t > jetzt - RATE_FENSTER_MS);
  if (liste.length >= RATE_MAX) {
    rateSpeicher.set(ip, liste);
    return true;
  }
  liste.push(jetzt);
  rateSpeicher.set(ip, liste);
  if (rateSpeicher.size > 5000) rateSpeicher.clear();
  return false;
}

function herkunftFremd(request) {
  const origin = request.headers.get('Origin') || '';
  if (origin) return !originErlaubt(origin);
  const referer = request.headers.get('Referer') || '';
  if (!referer) return false; // fehlend vorerst tolerieren
  try {
    return !originErlaubt(new URL(referer).origin);
  } catch {
    return true;
  }
}

function spamGruende({ name, firma, message }) {
  const gruende = [];
  if (LINK_MUSTER.test(message) || LINK_MUSTER.test(name) || LINK_MUSTER.test(firma)) gruende.push('link');
  if (/williamdon/i.test(name)) gruende.push('name');
  if (firma.trim().toLowerCase() === 'google') gruende.push('firma');
  if (LOCK_MUSTER.test(message) && !DEUTSCH_MUSTER.test(message)) gruende.push('lockphrase-en');
  return gruende;
}

// ---- Turnstile (v11) ------------------------------------------------------
// false = nur protokollieren, true = fehlender/ungueltiger Token -> still verwerfen
const TURNSTILE_ERZWINGEN = true;
const TURNSTILE_HOSTS = ['kanid.de', 'www.kanid.de'];

async function pruefeTurnstile(token, ip, env) {
  if (!env.TURNSTILE_SECRET) return { ok: false, grund: 'kein-secret' };
  if (!token) return { ok: false, grund: 'fehlt' };
  try {
    const daten = new FormData();
    daten.append('secret', env.TURNSTILE_SECRET);
    daten.append('response', token);
    if (ip) daten.append('remoteip', ip);
    const antwortTs = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: daten });
    const ergebnis = await antwortTs.json();
    if (!ergebnis.success) {
      return { ok: false, grund: 'ungueltig', codes: ergebnis['error-codes'] || [] };
    }
    if (ergebnis.hostname && !TURNSTILE_HOSTS.includes(ergebnis.hostname)) {
      return { ok: false, grund: 'hostname', hostname: ergebnis.hostname };
    }
    return { ok: true, grund: 'ok' };
  } catch (fehler) {
    return { ok: false, grund: 'fehler-siteverify' };
  }
}

function verwerfen(request, grund, info = {}) {
  console.log(JSON.stringify({
    event: 'kontakt_verworfen',
    grund,
    ip: ipKurz(clientIp(request)),
    land: request.cf?.country || '',
    ...info,
  }));
  return antwort(request, { ok: true, mail: true }, 200);
}

async function sendeResend(apiKey, brief) {
  const antwort = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(brief),
  });
  return antwort.ok;
}

function htmlEsc(wert) {
  return String(wert)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function htmlZeilen(wert) {
  return htmlEsc(wert).replace(/\n/g, '<br>');
}

function feldZelle(label, wert, breite) {
  return `<td width="${breite}" style="width:${breite};padding:10px 12px;border:1px solid #0e2733;vertical-align:top;">
    <div style="margin:0 0 5px;font-family:Consolas,'Courier New',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#1b6ba4;">${label}</div>
    <div style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.4;color:#0e2733;font-weight:500;">${wert}</div>
  </td>`;
}

// Neutral: uebernimmt bewusst KEINE Formulareingaben (Name, Firma, Nachricht),
// damit das Formular nicht als Spam-Relay an fremde Adressen missbraucht wird.
function bestaetigungHtml() {
  const heute = new Date();
  const stand = heute.toISOString().slice(0, 7);
  const datum = heute.toISOString().slice(0, 10);
  const nummer = `KANID-MAIL-${datum.replace(/-/g, '')}`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Eingangsbestätigung</title>
</head>
<body style="margin:0;padding:0;background:#e9ecee;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#e9ecee" style="background:#e9ecee;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #0e2733;border-collapse:collapse;">

          <tr>
            <td style="padding:22px 24px 18px;border-bottom:1px solid #0e2733;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="220" style="vertical-align:middle;">
                    <img src="https://kanid.de/assets/img/LOGO.png" width="176" height="48" alt="KANID" style="display:block;width:176px;height:auto;border:0;">
                  </td>
                  <td align="right" style="vertical-align:middle;font-family:Consolas,'Courier New',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#1b6ba4;line-height:1.55;">
                    Eingangsbestätigung<br>
                    ${htmlEsc(nummer)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <tr>
            <td style="padding:28px 24px 8px;font-family:Consolas,'Courier New',monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#1b6ba4;">
              Nachricht eingegangen
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.2;font-weight:700;color:#0e2733;">
              Wir haben Ihre Anfrage erhalten.
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#21262a;">
              Guten Tag,<br><br>
              Ihre Nachricht ist bei uns eingegangen. Diese E-Mail bestätigt nur den Empfang.
              Sie ist keine Auftragsbestätigung und kein Angebot.
            </td>
          </tr>

          <tr>
            <td style="padding:0 24px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#21262a;">
              Wir antworten werktags innerhalb weniger Stunden.<br><br>
              Mit freundlichen Grüßen<br>
              <strong style="color:#0e2733;">Konstantin Vinogradov</strong>
            </td>
          </tr>

          <tr>
            <td style="padding:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  ${feldZelle('KANID UG', 'Filderstadt', '25%')}
                  ${feldZelle('Blatt', '01 / 01', '25%')}
                  ${feldZelle('Stand', stand, '25%')}
                  ${feldZelle('Maßstab', '1:1', '25%')}
                </tr>
                <tr>
                  ${feldZelle('Benennung', 'Eingangsbestätigung Kontakt', '50%')}
                  ${feldZelle('Zeichnungsnummer', nummer, '50%')}
                </tr>
                <tr>
                  ${feldZelle('Bearbeiter', 'K. Vinogradov', '50%')}
                  ${feldZelle('Anschrift', 'Heinrich-Hertz-Str. 11<br>70794 Filderstadt', '50%')}
                </tr>
                <tr>
                  ${feldZelle('Register', 'HRB 798044 · Amtsgericht Stuttgart', '50%')}
                  ${feldZelle('Kontakt', '+49 1520 7921611<br>info@kanid.de · kanid.de', '50%')}
                </tr>
              </table>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

const VERSAND_EUR = 6;
const BANK = {
  empfaenger: 'KANID UG (haftungsbeschränkt)',
  iban: 'DE27 1001 8000 0069 2442 74',
  bic: 'FNOMDEB2',
  bank: 'FINOM PAYMENTS',
};

function euro(wert) {
  return new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' }).format(wert);
}

function bytesZuB64url(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i += 1) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlZuBytes(text) {
  let s = text.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSchluessel(geheim) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(geheim),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

async function signiereAuftrag(daten, geheim) {
  const json = JSON.stringify(daten);
  const key = await hmacSchluessel(geheim);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(json));
  return `${bytesZuB64url(new TextEncoder().encode(json))}.${bytesZuB64url(sig)}`;
}

async function leseAuftrag(token, geheim) {
  const teile = String(token || '').split('.');
  if (teile.length !== 2) return null;
  const jsonBytes = b64urlZuBytes(teile[0]);
  const json = new TextDecoder().decode(jsonBytes);
  const key = await hmacSchluessel(geheim);
  const ok = await crypto.subtle.verify('HMAC', key, b64urlZuBytes(teile[1]), new TextEncoder().encode(json));
  if (!ok) return null;
  try {
    const daten = JSON.parse(json);
    if (!daten || !daten.bestellnummer || !daten.email) return null;
    return daten;
  } catch {
    return null;
  }
}

function versandGewicht(artikel) {
  const t = String(artikel || '').toLowerCase();
  if (t.includes('2.0') || t.includes('2-0') || t.includes('zollstock')) {
    return { gramm: 400, hinweis: 'SoloMeter 2.0 laut Stammdaten, plus Karton' };
  }
  if (t.includes('solometer')) {
    return { gramm: 250, hinweis: 'SoloMeter laut Stammdaten, plus Karton' };
  }
  if (t.includes('querle')) {
    return { gramm: 100, hinweis: 'QuerLe laut Stammdaten, plus Karton' };
  }
  return { gramm: 300, hinweis: 'Schätzung, bitte nachwiegen' };
}

const KARTON_GRAMM = 80;

const ABSENDER = {
  name1: 'KANID UG (haftungsbeschränkt)',
  strasse: 'Heinrich-Hertz-Str.',
  hausnr: '11',
  plz: '70794',
  ort: 'Filderstadt',
};

// Header exakt aus der Easylog-Vorlage
// "DHL Easylogkonvertiert-Vorlage Sendungsdatenimport" (PIPE, UTF-8, Komma).
const EASYLOG_KOPF = 'Status|Status-Text|POOL_REFNR|Abrechnungsnummer Versenden|Abrechnungsnummer Retoure Versenden|Absender Name 1 Versenden|Absender Straße Versenden|Absender Hausnummer Versenden|Absender PLZ Versenden|Absender Ort Versenden|Retourenempfänger Name 1 Versenden|Retourenempfänger Straße Versenden|Retourenempfänger Hausnummer Versenden|Retourenempfänger PLZ Versenden|Retourenempfänger Ort Versenden|Kontoreferenz Versenden|POOL_EMPF_NAME1|POOL_EMPF_NAME2|POOL_EMPF_NAME3|POOL_EMPF_PLZ|POOL_EMPF_ORT|POOL_EMPF_STRASSE|POOL_EMPF_HAUSNR|POOL_EMPF_TEL|POOL_EMPF_EMAIL|POOL_EMPF_MINDESTALTER|POOL_EMPF_LANDCODE|POOL_GEWICHT|POOL_V_ZOLL_WARENART|POOL_V_VORAUSVERF_INT|POOL_VORDATE|POOL_EINZELWUNSCH |POOL_VERWENDUNGSZWECK|NN-Verw-Zweck1|NN-Verw-Zweck2|NN-Betrag|TV-Betrag|Alter Alterssichtprüfung 01|Frankatur 54|Zoll Beschreibung|Zoll Ursprungsland|Zoll Zolltarifnummer|Zoll Gewicht|Zoll Warenwert|Zoll Warenart|Zoll Warenart Beschreibung für Sonstiges|(Zoll Warenart Erklärung)|Vorausverfügungsart 53|(VorV Int Erklärung)|DHL Paket 01|GoGREEN 01|Transportversicherung 01|Eigenhändig 01|Nachnahme 01|Alterssichtprüfung 01|DHL Retoure 07|Weltpaket 53|Nachnahme 53|GoGREEN 53|Vorausverfügung 53|Premium 53|Rückschein 53|Transportversicherung 53|DHL Europaket 54|GoGREEN 54|Transportversicherung 54|Versandbestätigung alle|Sperrgut 01/53|Produkt-Service-Zuordnung Gesamt|###|POOL_V_VERFAHREN|POOL_V_TEILNAHME|POOL_V_EXTRASLST|POOL_V_ABS_REFNR|POOL_V_MAND_REFNR|POOL_V_PRODUKT_CN|POOL_ANZAHL_SENDUNGEN|POOL_ZOLL_WARENLISTE|POOL_V_VORAUSVERF_INT_TERMIN|Bankname Versenden|IBAN Versenden|Zahlungsempfänger Versenden|BIC Versenden|POOL_EMPF_REFNR|Absender Name 2 Versenden|Zoll MRN|Paketankündigung Versenden|Retourenempfänger Name 2 Versenden|GoGreenPlus (Beilegerretoure)';

function versandMenge(daten) {
  const menge = Number(daten && daten.menge);
  return Number.isFinite(menge) && menge > 0 ? menge : 1;
}

function versandBruttoGramm(daten) {
  return versandGewicht(daten.artikel).gramm * versandMenge(daten) + KARTON_GRAMM;
}

function versandProdukt(daten) {
  return versandBruttoGramm(daten) <= 1000 ? 'DHL Kleinpaket' : 'DHL Paket';
}

function teileStrasse(roh) {
  const text = String(roh || '').replace(/\s+/g, ' ').trim();
  const treffer = text.match(/^(.*\S)\s+(\d+[a-zA-Z]?(?:\s*[-/]\s*\d+[a-zA-Z]?)?)$/);
  if (!treffer) return { strasse: text, hausnr: '', getrennt: false };
  return {
    strasse: treffer[1].trim(),
    hausnr: treffer[2].replace(/\s+/g, ''),
    getrennt: true,
  };
}

function easylogFeld(wert) {
  const text = String(wert ?? '').replace(/[\r\n]+/g, ' ').trim();
  if (!text) return '';
  if (/[|"\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function easylogGewichtKg(gramm) {
  const kg = Math.max(Number(gramm) || 0, 1) / 1000;
  return kg.toFixed(3).replace('.', ',').replace(/0+$/, '').replace(/,$/, ',0');
}

function utf8ZuB64(text) {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

function easylogDatei(daten) {
  const kopf = EASYLOG_KOPF.split('|');
  const empf = teileStrasse(daten.strasse);
  const produkt = versandProdukt(daten);
  const brutto = versandBruttoGramm(daten);
  const werte = Object.fromEntries(kopf.map((spalte) => [spalte, '']));

  werte.POOL_REFNR = daten.bestellnummer || '';
  werte['Kontoreferenz Versenden'] = daten.bestellnummer || '';
  werte.POOL_EMPF_REFNR = daten.bestellnummer || '';
  werte['Absender Name 1 Versenden'] = ABSENDER.name1;
  werte['Absender Straße Versenden'] = ABSENDER.strasse;
  werte['Absender Hausnummer Versenden'] = ABSENDER.hausnr;
  werte['Absender PLZ Versenden'] = ABSENDER.plz;
  werte['Absender Ort Versenden'] = ABSENDER.ort;
  werte.POOL_EMPF_NAME1 = daten.name || '';
  werte.POOL_EMPF_PLZ = daten.plz || '';
  werte.POOL_EMPF_ORT = daten.ort || '';
  werte.POOL_EMPF_STRASSE = empf.strasse;
  werte.POOL_EMPF_HAUSNR = empf.hausnr;
  werte.POOL_EMPF_EMAIL = daten.email || '';
  werte.POOL_EMPF_LANDCODE = 'DE';
  werte.POOL_GEWICHT = easylogGewichtKg(brutto);
  werte['Produkt-Service-Zuordnung Gesamt'] = produkt;
  werte['Paketankündigung Versenden'] = daten.email || '';
  werte.POOL_ANZAHL_SENDUNGEN = '1';
  if (produkt === 'DHL Paket') werte['DHL Paket 01'] = 'X';

  const name = String(daten.bestellnummer || 'sendung').replace(/[^\w.-]+/g, '_');
  return {
    filename: `${name}-dhl-easylog.csv`,
    inhalt: `${EASYLOG_KOPF}\n${kopf.map((spalte) => easylogFeld(werte[spalte])).join('|')}\n`,
    produkt,
    brutto,
    empf,
  };
}

function easylogAnhang(daten) {
  const datei = easylogDatei(daten);
  return {
    filename: datei.filename,
    content: utf8ZuB64(datei.inhalt),
  };
}

function versandSeite(daten, token) {
  const gewicht = versandGewicht(daten.artikel);
  const datei = easylogDatei(daten);
  const paket = datei.produkt;
  const adresse = [daten.name, daten.strasse, `${daten.plz} ${daten.ort}`, 'Deutschland']
    .filter((zeile) => String(zeile || '').trim() && String(zeile).trim() !== 'undefined')
    .join('\n');
  const download = token ? `/versand?t=${htmlEsc(token)}&download=1` : '';
  const zeile = (label, wert) => `
    <div class="zeile">
      <div>
        <div class="lab">${label}</div>
        <div class="wert" data-copy>${htmlEsc(wert || '—')}</div>
      </div>
      <button type="button" class="copy">Kopieren</button>
    </div>`;

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>Versand ${htmlEsc(daten.bestellnummer)}</title>
  <style>
    body { margin: 0; background: #e9ecee; font-family: Arial, Helvetica, sans-serif; color: #0e2733; }
    main { max-width: 620px; margin: 32px auto; padding: 28px; background: #fff; border: 1px solid #0e2733; }
    .mono { font-family: Consolas, "Courier New", monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #1b6ba4; }
    h1 { font-size: 22px; margin: 8px 0 18px; }
    .zeile { display: flex; gap: 12px; align-items: center; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #c9d0d4; }
    .lab { font-family: Consolas, "Courier New", monospace; font-size: 10px; letter-spacing: .12em; text-transform: uppercase; color: #1b6ba4; margin-bottom: 4px; }
    .wert { font-size: 16px; line-height: 1.35; white-space: pre-wrap; }
    .copy { flex: 0 0 auto; padding: 10px 14px; border: 1px solid #0e2733; background: #fff; color: #0e2733; font-weight: 700; cursor: pointer; }
    .copy:hover, .copy.ok { background: #f2c200; border-color: #f2c200; }
    .block { margin-top: 22px; }
    a.dhl { display: inline-block; margin-top: 18px; margin-right: 10px; padding: 12px 16px; background: #f2c200; color: #0e2733; font-weight: 700; text-decoration: none; }
    a.sek { background: #fff; border: 1px solid #0e2733; }
    .note { margin-top: 16px; color: #21262a; font-size: 14px; line-height: 1.5; }
    .warn { margin-top: 16px; padding: 12px; border: 1px solid #0e2733; background: #fff8d6; font-size: 14px; line-height: 1.5; }
  </style>
</head>
<body>
<main>
  <p class="mono">DHL Easylog</p>
  <h1>Label-Daten ${htmlEsc(daten.bestellnummer)}</h1>
  <p>Die Importdatei ist mit deiner Vorlage <strong>DHL Easylogkonvertiert-Vorlage Sendungsdatenimport</strong> ausgefüllt. In Easylog: Sendungsdatenimport → diese Datei wählen.</p>
  ${download ? `<a class="dhl" href="${download}">Easylog-Datei herunterladen</a>` : ''}
  ${datei.empf.getrennt ? '' : '<p class="warn">Straße und Hausnummer konnten nicht getrennt werden. Bitte in Easylog prüfen.</p>'}

  ${zeile('Name', daten.name)}
  ${zeile('Straße', datei.empf.strasse)}
  ${zeile('Hausnummer', datei.empf.hausnr || '—')}
  ${zeile('PLZ', daten.plz)}
  ${zeile('Ort', daten.ort)}
  ${zeile('Land', 'DE')}
  ${zeile('E-Mail', daten.email)}
  ${zeile('Bestellnummer / Referenz', daten.bestellnummer)}
  ${zeile('Artikel', `${daten.artikel} × ${daten.menge}`)}
  ${zeile('Gewicht inkl. Karton', `${datei.brutto} g (${easylogGewichtKg(datei.brutto)} kg)`)}
  ${zeile('DHL-Produkt', paket)}

  <div class="block">
    <div class="zeile">
      <div>
        <div class="lab">Ganze Adresse</div>
        <div class="wert" data-copy>${htmlEsc(adresse)}</div>
      </div>
      <button type="button" class="copy">Kopieren</button>
    </div>
  </div>

  <p class="note">${htmlEsc(gewicht.hinweis)}. Vorgeschlagenes Produkt: ${htmlEsc(paket)}. Die Abrechnungsnummer bleibt leer — Easylog nimmt euer Geschäftskundenkonto.</p>
  ${download ? `<a class="dhl" href="${download}">Easylog-Datei herunterladen</a>` : ''}
  <a class="dhl sek" href="https://www.dhl.de/de/geschaeftskunden.html" target="_blank" rel="noopener">DHL Geschäftskunden öffnen</a>
  ${token ? `<p class="note"><a href="/bestaetigen?t=${htmlEsc(token)}">Zur Bestellbestätigung</a></p>` : ''}
</main>
<script>
document.querySelectorAll('.copy').forEach((knopf) => {
  knopf.addEventListener('click', async () => {
    const text = knopf.parentElement.querySelector('[data-copy]').innerText;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const feld = document.createElement('textarea');
      feld.value = text;
      document.body.appendChild(feld);
      feld.select();
      document.execCommand('copy');
      feld.remove();
    }
    knopf.textContent = 'Kopiert';
    knopf.classList.add('ok');
    setTimeout(() => {
      knopf.textContent = 'Kopieren';
      knopf.classList.remove('ok');
    }, 1400);
  });
});
</script>
</body>
</html>`;
}

async function handleVersand(request, env, url) {
  const geheim = env.BESTELL_SECRET || env.RESEND_API_KEY;
  const token = url.searchParams.get('t');
  const daten = await leseAuftrag(token, geheim);
  if (!daten) {
    return new Response(htmlSeite('Ungültig', '<p class="mono">Link ungültig</p><h1>Dieser Versandlink gilt nicht.</h1>'), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=UTF-8', 'X-Robots-Tag': 'noindex' },
    });
  }
  if (url.searchParams.get('download')) {
    const datei = easylogDatei(daten);
    return new Response(datei.inhalt, {
      headers: {
        'Content-Type': 'text/csv; charset=UTF-8',
        'Content-Disposition': `attachment; filename="${datei.filename}"`,
        'Cache-Control': 'no-store',
        'X-Robots-Tag': 'noindex',
      },
    });
  }
  return new Response(versandSeite(daten, token), {
    headers: { 'Content-Type': 'text/html; charset=UTF-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' },
  });
}

function htmlSeite(titel, innen) {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="robots" content="noindex">
  <title>${htmlEsc(titel)}</title>
  <style>
    body { margin: 0; background: #e9ecee; font-family: Arial, Helvetica, sans-serif; color: #0e2733; }
    main { max-width: 560px; margin: 40px auto; padding: 28px; background: #fff; border: 1px solid #0e2733; }
    .mono { font-family: Consolas, "Courier New", monospace; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; color: #1b6ba4; }
    h1 { font-size: 22px; margin: 8px 0 16px; }
    p, li { line-height: 1.5; }
    button { margin-top: 18px; padding: 12px 16px; border: 0; background: #f2c200; color: #0e2733; font-weight: 700; cursor: pointer; }
  </style>
</head>
<body><main>${innen}</main></body>
</html>`;
}

const WIDERRUF_TEXT = `Widerrufsrecht

Sie haben das Recht, binnen vierzehn Tagen ohne Angabe von Gründen diesen Vertrag zu widerrufen.

Die Widerrufsfrist beträgt vierzehn Tage ab dem Tag,

- an dem Sie oder ein von Ihnen benannter Dritter, der nicht der Beförderer ist, die Waren in Besitz genommen haben bzw. hat;
- an dem Sie oder ein von Ihnen benannter Dritter, der nicht der Beförderer ist, die letzte Ware in Besitz genommen haben bzw. hat, wenn Sie mehrere Waren im Rahmen einer einheitlichen Bestellung bestellt haben und diese getrennt geliefert werden;
- an dem Sie oder ein von Ihnen benannter Dritter, der nicht der Beförderer ist, die letzte Teilsendung oder das letzte Stück in Besitz genommen haben bzw. hat, wenn eine Ware in mehreren Teilsendungen oder Stücken geliefert wird.

Um Ihr Widerrufsrecht auszuüben, müssen Sie uns

KANID UG (haftungsbeschränkt)
Heinrich-Hertz-Str. 11
70794 Filderstadt
Deutschland
Telefon: +49 1520 7921611
E-Mail: info@kanid.de

mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist.

Zur Wahrung der Widerrufsfrist reicht es aus, dass Sie die Mitteilung über die Ausübung des Widerrufsrechts vor Ablauf der Widerrufsfrist absenden.

Folgen des Widerrufs

Wenn Sie diesen Vertrag widerrufen, haben wir Ihnen alle Zahlungen, die wir von Ihnen erhalten haben, einschließlich der Lieferkosten (mit Ausnahme der zusätzlichen Kosten, die sich daraus ergeben, dass Sie eine andere Art der Lieferung als die von uns angebotene, günstigste Standardlieferung gewählt haben), unverzüglich und spätestens binnen vierzehn Tagen ab dem Tag zurückzuzahlen, an dem die Mitteilung über Ihren Widerruf dieses Vertrags bei uns eingegangen ist. Für diese Rückzahlung verwenden wir dasselbe Zahlungsmittel, das Sie bei der ursprünglichen Transaktion eingesetzt haben, es sei denn, mit Ihnen wurde ausdrücklich etwas anderes vereinbart; in keinem Fall werden Ihnen wegen dieser Rückzahlung Entgelte berechnet.

Wir können die Rückzahlung verweigern, bis wir die Waren wieder zurückerhalten haben oder bis Sie den Nachweis erbracht haben, dass Sie die Waren zurückgesandt haben, je nachdem, welches der frühere Zeitpunkt ist.

Sie haben die Waren unverzüglich und in jedem Fall spätestens binnen vierzehn Tagen ab dem Tag, an dem Sie uns über den Widerruf dieses Vertrags unterrichten, an uns zurückzusenden oder zu übergeben. Die Frist ist gewahrt, wenn Sie die Waren vor Ablauf der Frist von vierzehn Tagen absenden.

Sie tragen die unmittelbaren Kosten der Rücksendung der Waren.

Sie müssen für einen etwaigen Wertverlust der Waren nur aufkommen, wenn dieser Wertverlust auf einen zur Prüfung der Beschaffenheit, Eigenschaften und Funktionsweise der Waren nicht notwendigen Umgang mit ihnen zurückzuführen ist.

Das Widerrufsrecht gilt für alle Ausführungen, auch für die mit Ihrem Logo.

Das Muster-Widerrufsformular liegt dieser E-Mail als PDF bei und steht unter https://kanid.de/widerruf bereit.`;

function bestellBestaetigungText(daten) {
  const datum = daten.datum
    ? new Date(daten.datum + 'T12:00:00').toLocaleDateString('de-DE')
    : new Date().toLocaleDateString('de-DE');
  return [
    `Guten Tag ${daten.name},`,
    '',
    'vielen Dank für Ihre Bestellung. Hiermit nehmen wir Ihre Bestellung an; damit ist der Kaufvertrag zustande gekommen.',
    '',
    `Bestellnummer: ${daten.bestellnummer}`,
    `Bestelldatum: ${datum}`,
    `Artikel: ${daten.artikel} × ${daten.menge} — ${euro(daten.einzelpreis)}`,
    `Zwischensumme: ${euro(daten.zwischensumme ?? daten.einzelpreis * daten.menge)}`,
    `Versand (DHL, Deutschland): ${euro(VERSAND_EUR)}`,
    `Gesamtsumme: ${euro(daten.summe)}`,
    '',
    'Alle Preise enthalten die gesetzliche Umsatzsteuer von 19 %.',
    '',
    `Zahlungsart: ${daten.zahlungsart || 'Vorkasse per Überweisung'}`,
    'Lieferung: Wir fertigen erst nach Ihrer Bestellung. In der Regel ist Ihre Sendung nach 4–6 Werktagen bei Ihnen, spätestens nach 15 Werktagen ab Zahlungseingang. Versand mit DHL.',
    daten.logo
      ? 'Bitte senden Sie uns Ihr Logo als SVG, DXF oder PDF an info@kanid.de. Die Fertigung startet, sobald die Datei geprüft und freigegeben ist.'
      : null,
    '',
    WIDERRUF_TEXT,
    '',
    'Es gelten unsere AGB für Verbraucher: https://kanid.de/agb-verbraucher',
    '',
    'KANID UG (haftungsbeschränkt) · Heinrich-Hertz-Str. 11 · 70794 Filderstadt',
    'Geschäftsführer: Konstantin Vinogradov',
    'Amtsgericht Stuttgart HRB 798044 · USt-IdNr. DE451539743',
    'info@kanid.de · +49 1520 7921611',
  ].filter((zeile) => zeile !== null).join('\n');
}

function bestellBestaetigungHtml(daten) {
  const stand = new Date().toISOString().slice(0, 7);
  const datum = daten.datum
    ? new Date(daten.datum + 'T12:00:00').toLocaleDateString('de-DE')
    : new Date().toLocaleDateString('de-DE');

  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bestellbestätigung</title></head>
<body style="margin:0;padding:0;background:#e9ecee;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#e9ecee">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #0e2733;border-collapse:collapse;">
          <tr>
            <td style="padding:22px 24px 18px;border-bottom:1px solid #0e2733;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td><img src="https://kanid.de/assets/img/LOGO.png" width="176" alt="KANID" style="display:block;width:176px;height:auto;border:0;"></td>
                  <td align="right" style="font-family:Consolas,'Courier New',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#1b6ba4;line-height:1.55;">
                    Bestellbestätigung<br>${htmlEsc(daten.bestellnummer)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px;font-family:Consolas,'Courier New',monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#1b6ba4;">Vertrag angenommen</td>
          </tr>
          <tr>
            <td style="padding:0 24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.2;font-weight:700;color:#0e2733;">
              Ihre Bestellung ist angenommen.
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#21262a;">
              Guten Tag ${htmlEsc(daten.name)},<br><br>
              vielen Dank für Ihre Bestellung. Hiermit nehmen wir Ihre Bestellung an; damit ist der Kaufvertrag zustande gekommen.
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  ${feldZelle('Bestellnummer', htmlEsc(daten.bestellnummer), '50%')}
                  ${feldZelle('Bestelldatum', htmlEsc(datum), '50%')}
                </tr>
                <tr>
                  ${feldZelle('Artikel', htmlEsc(daten.artikel), '50%')}
                  ${feldZelle('Menge', String(daten.menge), '50%')}
                </tr>
                <tr>
                  ${feldZelle('Einzelpreis', euro(daten.einzelpreis), '50%')}
                  ${feldZelle('Versand DHL', euro(VERSAND_EUR), '50%')}
                </tr>
                <tr>
                  ${feldZelle('Gesamtsumme', euro(daten.summe), '50%')}
                  ${feldZelle('Zahlungsart', htmlEsc(daten.zahlungsart || 'Vorkasse per Überweisung'), '50%')}
                </tr>
                <tr>
                  <td colspan="2" style="padding:12px;border:1px solid #0e2733;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#0e2733;">
                    Alle Preise enthalten 19 % Umsatzsteuer. Lieferung in der Regel nach 4–6 Werktagen, spätestens nach 15 Werktagen ab Zahlungseingang. Versand mit DHL.
                    ${daten.logo ? '<br><br>Bitte senden Sie uns Ihr Logo als SVG, DXF oder PDF an info@kanid.de. Die Fertigung startet, sobald die Datei geprüft ist.' : ''}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#0e2733;white-space:pre-wrap;">${htmlEsc(WIDERRUF_TEXT)}</td>
          </tr>
          <tr>
            <td style="padding:0 24px 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#21262a;">
              Das Muster-Widerrufsformular liegt als PDF bei.<br>
              AGB für Verbraucher: <a href="https://kanid.de/agb-verbraucher" style="color:#1b6ba4;">kanid.de/agb-verbraucher</a>
              <br><br>Mit freundlichen Grüßen<br><strong>Konstantin Vinogradov</strong>
            </td>
          </tr>
          <tr>
            <td>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  ${feldZelle('KANID UG', 'Filderstadt', '25%')}
                  ${feldZelle('Blatt', '01 / 01', '25%')}
                  ${feldZelle('Stand', stand, '25%')}
                  ${feldZelle('Maßstab', '1:1', '25%')}
                </tr>
                <tr>
                  ${feldZelle('Benennung', 'Bestellbestätigung', '50%')}
                  ${feldZelle('Zeichnungsnummer', htmlEsc(daten.bestellnummer), '50%')}
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function pdfAnhang() {
  const antwort = await fetch('https://kanid.de/assets/widerrufsformular.pdf');
  if (!antwort.ok) return null;
  const buf = await antwort.arrayBuffer();
  let bin = '';
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
  return {
    filename: 'widerrufsformular.pdf',
    content: btoa(bin),
  };
}

async function handleBestaetigen(request, env, url) {
  const geheim = env.BESTELL_SECRET || env.RESEND_API_KEY;
  if (!geheim) {
    return new Response(htmlSeite('Fehler', '<p>Kein Geheimnis konfiguriert.</p>'), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
  }

  const token = request.method === 'POST'
    ? (await request.formData()).get('t')
    : url.searchParams.get('t');
  const daten = await leseAuftrag(token, geheim);

  if (!daten) {
    return new Response(htmlSeite('Ungültig', '<p class="mono">Link ungültig</p><h1>Dieser Bestätigungslink gilt nicht.</h1><p>Er ist beschädigt oder gehört zu einem anderen Schlüssel.</p>'), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=UTF-8', 'X-Robots-Tag': 'noindex' },
    });
  }

  if (request.method === 'GET') {
    const innen = `
      <p class="mono">Zahlungseingang</p>
      <h1>Bestellbestätigung senden?</h1>
      <p>Nur klicken, wenn die Überweisung <strong>${htmlEsc(daten.bestellnummer)}</strong> wirklich da ist. Damit nehmen Sie den Vertrag an.</p>
      <ul>
        <li>${htmlEsc(daten.artikel)} × ${daten.menge}</li>
        <li>${euro(daten.summe)} inkl. Versand</li>
        <li>${htmlEsc(daten.name)}, ${htmlEsc(daten.email)}</li>
        <li>${htmlEsc(daten.strasse)}, ${htmlEsc(daten.plz)} ${htmlEsc(daten.ort)}</li>
      </ul>
      <form method="post" action="/bestaetigen">
        <input type="hidden" name="t" value="${htmlEsc(String(token))}">
        <button type="submit">Zahlung ist da — Vertrag annehmen</button>
      </form>`;
    return new Response(htmlSeite('Bestellbestätigung senden', innen), {
      headers: { 'Content-Type': 'text/html; charset=UTF-8', 'X-Robots-Tag': 'noindex', 'Cache-Control': 'no-store' },
    });
  }

  if (request.method !== 'POST') {
    return new Response('Nur GET oder POST', { status: 405 });
  }

  const anhang = await pdfAnhang();
  const brief = {
    from: 'KANID Factory <info@kanid.de>',
    to: [daten.email],
    bcc: [EMPFAENGER],
    subject: `Ihre Bestellung bei KANID — Bestellbestätigung ${daten.bestellnummer}`,
    text: bestellBestaetigungText(daten),
    html: bestellBestaetigungHtml(daten),
  };
  if (anhang) brief.attachments = [anhang];

  const ok = await sendeResend(env.RESEND_API_KEY, brief);
  if (!ok) {
    return new Response(htmlSeite('Fehler', '<p>Die Bestätigung konnte nicht gesendet werden. Resend prüfen.</p>'), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
  }

  return new Response(htmlSeite('Gesendet', `
    <p class="mono">Erledigt</p>
    <h1>Bestellbestätigung ist raus.</h1>
    <p>An ${htmlEsc(daten.email)}, Kopie an ${htmlEsc(EMPFAENGER)}. PDF liegt bei, soweit der Abruf von kanid.de geklappt hat.</p>
    <p><a href="/versand?t=${htmlEsc(String(token))}">Weiter zum DHL-Versand</a></p>
  `), {
    headers: { 'Content-Type': 'text/html; charset=UTF-8', 'X-Robots-Tag': 'noindex' },
  });
}

function vorkasseEingangHtml(daten) {
  const stand = new Date().toISOString().slice(0, 7);
  const nummer = daten.bestellnummer;

  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Bestelleingang</title></head>
<body style="margin:0;padding:0;background:#e9ecee;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#e9ecee" style="background:#e9ecee;">
    <tr>
      <td align="center" style="padding:32px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #0e2733;border-collapse:collapse;">
          <tr>
            <td style="padding:22px 24px 18px;border-bottom:1px solid #0e2733;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td style="vertical-align:middle;">
                    <img src="https://kanid.de/assets/img/LOGO.png" width="176" alt="KANID" style="display:block;width:176px;height:auto;border:0;">
                  </td>
                  <td align="right" style="vertical-align:middle;font-family:Consolas,'Courier New',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#1b6ba4;line-height:1.55;">
                    Bestelleingang Vorkasse<br>
                    ${htmlEsc(nummer)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px;font-family:Consolas,'Courier New',monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#1b6ba4;">
              Noch keine Annahme
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:24px;line-height:1.2;font-weight:700;color:#0e2733;">
              Wir haben Ihre Bestellung erhalten.
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#21262a;">
              Guten Tag ${htmlEsc(daten.name)},<br><br>
              Ihre Bestellung ${htmlEsc(nummer)} ist eingegangen. Diese E-Mail bestätigt nur den Empfang
              und nennt die Überweisungsdaten. Sie ist keine Auftragsbestätigung.
              Der Kaufvertrag kommt erst mit unserer späteren Bestellbestätigung oder mit dem Versand zustande.
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  ${feldZelle('Bestellnummer', htmlEsc(nummer), '50%')}
                  ${feldZelle('Zahlungsart', 'Vorkasse · SEPA', '50%')}
                </tr>
                <tr>
                  ${feldZelle('Artikel', htmlEsc(daten.artikel), '50%')}
                  ${feldZelle('Menge', String(daten.menge), '50%')}
                </tr>
                <tr>
                  ${feldZelle('Einzelpreis', euro(daten.einzelpreis), '50%')}
                  ${feldZelle('Versand DHL', euro(VERSAND_EUR), '50%')}
                </tr>
                <tr>
                  ${feldZelle('Gesamtsumme', euro(daten.summe), '50%')}
                  ${feldZelle('Lieferung', '4–6, höchstens 15 Werktage ab Zahlungseingang', '50%')}
                </tr>
                <tr>
                  <td colspan="2" width="100%" style="padding:12px;border:1px solid #0e2733;vertical-align:top;">
                    <div style="margin:0 0 6px;font-family:Consolas,'Courier New',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#1b6ba4;">Lieferanschrift</div>
                    <div style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0e2733;">
                      ${htmlEsc(daten.name)}<br>
                      ${htmlEsc(daten.strasse)}<br>
                      ${htmlEsc(daten.plz)} ${htmlEsc(daten.ort)}
                    </div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 12px;font-family:Consolas,'Courier New',monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#1b6ba4;">
              Bitte überweisen
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  ${feldZelle('Empfänger', htmlEsc(BANK.empfaenger), '50%')}
                  ${feldZelle('Bank', htmlEsc(BANK.bank), '50%')}
                </tr>
                <tr>
                  ${feldZelle('IBAN', htmlEsc(BANK.iban), '50%')}
                  ${feldZelle('BIC', htmlEsc(BANK.bic), '50%')}
                </tr>
                <tr>
                  ${feldZelle('Verwendungszweck', htmlEsc(nummer), '50%')}
                  ${feldZelle('Betrag', euro(daten.summe), '50%')}
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#21262a;">
              Nur SEPA-Überweisung. Fertigung beginnt nach Zahlungseingang.
              ${daten.logo ? 'Bei einer Ausführung mit Logo senden Sie uns die Datei bitte als SVG, DXF oder PDF an info@kanid.de.' : ''}
              <br><br>
              Mit freundlichen Grüßen<br>
              <strong style="color:#0e2733;">Konstantin Vinogradov</strong>
            </td>
          </tr>
          <tr>
            <td style="padding:0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
                <tr>
                  ${feldZelle('KANID UG', 'Filderstadt', '25%')}
                  ${feldZelle('Blatt', '01 / 01', '25%')}
                  ${feldZelle('Stand', stand, '25%')}
                  ${feldZelle('Maßstab', '1:1', '25%')}
                </tr>
                <tr>
                  ${feldZelle('Benennung', 'Bestelleingang Vorkasse', '50%')}
                  ${feldZelle('Zeichnungsnummer', htmlEsc(nummer), '50%')}
                </tr>
                <tr>
                  ${feldZelle('Bearbeiter', 'K. Vinogradov', '50%')}
                  ${feldZelle('Kontakt', 'info@kanid.de · kanid.de', '50%')}
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function handleBestellung(request, env) {
  const form = await request.formData();
  const honeypot = feld(form.get('bot-field'), 80) + feld(form.get('_gotcha'), 80);
  if (honeypot) {
    return antwort(request, { ok: true, mail: false }, 200);
  }

  const gesetzt = feld(form.get('_gesetzt'), 20);
  if (/^\d+$/.test(gesetzt)) {
    const alter = Math.floor(Date.now() / 1000) - Number(gesetzt);
    if (alter >= 0 && alter < 2) {
      return antwort(request, { ok: true, mail: false }, 200);
    }
  }

  const name = feld(form.get('name'), 120);
  const email = feld(form.get('email'), 180);
  const strasse = feld(form.get('strasse'), 160);
  const plz = feld(form.get('plz'), 10);
  const ort = feld(form.get('ort'), 80);
  const artikel = feld(form.get('artikel'), 200);
  const anmerkung = typeof form.get('anmerkung') === 'string'
    ? form.get('anmerkung').replace(/\0/g, '').trim().slice(0, 1000)
    : '';
  const menge = parseInt(String(form.get('menge') || ''), 10);
  const einzelpreis = Number(String(form.get('einzelpreis') || '').replace(',', '.'));
  const widerruf = String(form.get('widerruf_gelesen') || '');
  let bestellnummer = feld(form.get('bestellnummer'), 20);

  if (!name || !email || !strasse || !plz || !ort || !artikel) {
    return antwort(request, { ok: false, error: 'validation', meldung: 'Bitte füllen Sie alle Pflichtfelder aus.' }, 422);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return antwort(request, { ok: false, error: 'validation', meldung: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.' }, 422);
  }
  if (!/^[0-9]{5}$/.test(plz)) {
    return antwort(request, { ok: false, error: 'validation', meldung: 'Bitte eine fünfstellige deutsche PLZ angeben.' }, 422);
  }
  if (!Number.isInteger(menge) || menge < 1 || menge > 10) {
    return antwort(request, { ok: false, error: 'validation', meldung: 'Menge muss zwischen 1 und 10 liegen.' }, 422);
  }
  if (!Number.isFinite(einzelpreis) || einzelpreis < 5 || einzelpreis > 200) {
    return antwort(request, { ok: false, error: 'validation', meldung: 'Der Artikelpreis ist ungültig.' }, 422);
  }
  if (!widerruf) {
    return antwort(request, { ok: false, error: 'validation', meldung: 'Bitte die Rechtstexte zur Kenntnis nehmen.' }, 422);
  }
  if (!/^KF-\d{4}-\d{4}$/.test(bestellnummer)) {
    bestellnummer = `KF-${new Date().getFullYear()}-${String(Math.floor(Math.random() * 9000) + 1000)}`;
  }

  if (!env.RESEND_API_KEY) {
    return antwort(request, {
      ok: false,
      error: 'config',
      meldung: 'Der Versand ist noch nicht eingerichtet.',
    }, 500);
  }

  const zwischensumme = einzelpreis * menge;
  const summe = zwischensumme + VERSAND_EUR;
  const logo = /logo/i.test(artikel);
  const daten = {
    name, email, strasse, plz, ort, artikel, menge, einzelpreis,
    zwischensumme, summe, bestellnummer, anmerkung, logo,
    datum: new Date().toISOString().slice(0, 10),
  };

  const geheim = env.BESTELL_SECRET || env.RESEND_API_KEY;
  const token = await signiereAuftrag(daten, geheim);
  const basis = new URL(request.url).origin;
  const bestaetigenUrl = `${basis}/bestaetigen?t=${token}`;
  const versandUrl = `${basis}/versand?t=${token}`;

  const intern = [
    'Neue Vorkasse-Bestellung KANID Factory',
    '',
    `Bestellnummer: ${bestellnummer}`,
    `Artikel:       ${artikel}`,
    `Menge:         ${menge}`,
    `Einzelpreis:   ${euro(einzelpreis)}`,
    `Versand:       ${euro(VERSAND_EUR)}`,
    `Gesamtsumme:   ${euro(summe)}`,
    '',
    `Name:    ${name}`,
    `E-Mail:  ${email}`,
    `Straße:  ${strasse}`,
    `Ort:     ${plz} ${ort}`,
    anmerkung ? `Anmerkung: ${anmerkung}` : null,
    '',
    'Wenn das Geld da ist — Bestätigung senden:',
    bestaetigenUrl,
    '',
    'DHL Easylog-Importdatei liegt an. In Easylog: Sendungsdatenimport',
    'mit Vorlage „DHL Easylogkonvertiert-Vorlage Sendungsdatenimport“.',
    'Erneut laden:',
    `${versandUrl}&download=1`,
    '',
    'Label-Daten mit Kopierknöpfen:',
    versandUrl,
  ].filter((zeile) => zeile !== null).join('\n');

  const internOk = await sendeResend(env.RESEND_API_KEY, {
    from: 'KANID Factory <info@kanid.de>',
    to: [EMPFAENGER],
    reply_to: email,
    subject: `[Vorkasse] ${bestellnummer} — ${artikel}`,
    text: intern,
    attachments: [easylogAnhang(daten)],
  });

  if (!internOk) {
    return antwort(request, {
      ok: false,
      error: 'mail',
      meldung: 'Die Bestellung konnte nicht übermittelt werden. Bitte schreiben Sie an info@kanid.de.',
    }, 500);
  }

  const kundeText = [
    `Guten Tag ${name},`,
    '',
    `Ihre Bestellung ${bestellnummer} ist eingegangen. Diese E-Mail bestätigt nur den Empfang, nicht die Annahme.`,
    '',
    `${artikel} × ${menge}`,
    `Gesamtsumme: ${euro(summe)} (inkl. ${euro(VERSAND_EUR)} Versand)`,
    '',
    `Bitte überweisen Sie per SEPA an:`,
    `Empfänger: ${BANK.empfaenger}`,
    `IBAN: ${BANK.iban}`,
    `BIC: ${BANK.bic}`,
    `Bank: ${BANK.bank}`,
    `Verwendungszweck: ${bestellnummer}`,
    '',
    'Fertigung beginnt nach Zahlungseingang.',
    '',
    'KANID UG (haftungsbeschränkt)',
    'info@kanid.de',
  ].join('\n');

  await sendeResend(env.RESEND_API_KEY, {
    from: 'KANID Factory <info@kanid.de>',
    to: [email],
    subject: `Ihre Bestellung ${bestellnummer} — bitte überweisen`,
    text: kundeText,
    html: vorkasseEingangHtml(daten),
  });

  return antwort(request, { ok: true, mail: true, bestellnummer }, 200);
}

const PAYPAL_HAENDLER = 'CXR79E3QL279J';

async function handlePaypal(request, env) {
  const roh = await request.text();
  const pruefung = await fetch('https://ipnpb.paypal.com/cgi-bin/webscr', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'KANID-IPN',
    },
    body: `cmd=_notify-validate&${roh}`,
  });
  const status = (await pruefung.text()).trim();
  if (status !== 'VERIFIED') {
    return new Response('INVALID', { status: 200 });
  }

  const felder = new URLSearchParams(roh);
  const zahlung = felder.get('payment_status') || '';
  const empfaenger = felder.get('receiver_id') || felder.get('business') || '';
  if (zahlung !== 'Completed') {
    return new Response('IGNORED', { status: 200 });
  }
  if (PAYPAL_HAENDLER && empfaenger && empfaenger !== PAYPAL_HAENDLER && !/kanid/i.test(empfaenger)) {
    return new Response('WRONG_RECEIVER', { status: 200 });
  }

  const email = (felder.get('payer_email') || '').trim();
  const name = [felder.get('first_name'), felder.get('last_name')].filter(Boolean).join(' ').trim()
    || (felder.get('address_name') || '').trim()
    || 'Kunde';
  const artikel = (felder.get('item_name') || felder.get('item_name1') || 'KANID Factory').trim();
  const menge = Math.max(1, parseInt(felder.get('quantity') || felder.get('quantity1') || '1', 10) || 1);
  const brutto = Number(felder.get('mc_gross') || '0');
  const versandPaypal = Number(felder.get('mc_shipping') || felder.get('shipping') || '0');
  const waehrung = felder.get('mc_currency') || '';
  const txn = (felder.get('txn_id') || '').trim();
  if (!email || !txn || waehrung !== 'EUR' || !Number.isFinite(brutto) || brutto <= 0) {
    return new Response('INCOMPLETE', { status: 200 });
  }

  const warenwert = Math.max(0, brutto - (Number.isFinite(versandPaypal) ? versandPaypal : 0));
  const einzelpreis = Math.round((warenwert / menge) * 100) / 100;
  const daten = {
    name,
    email,
    strasse: (felder.get('address_street') || '').trim(),
    plz: (felder.get('address_zip') || '').trim(),
    ort: (felder.get('address_city') || '').trim(),
    artikel,
    menge,
    einzelpreis,
    zwischensumme: warenwert,
    summe: brutto,
    bestellnummer: `PP-${txn.slice(-10)}`,
    anmerkung: '',
    logo: /logo/i.test(artikel),
    datum: new Date().toISOString().slice(0, 10),
    zahlungsart: 'PayPal',
  };

  const geheim = env.BESTELL_SECRET || env.RESEND_API_KEY;
  const token = await signiereAuftrag(daten, geheim);
  const versandUrl = `${new URL(request.url).origin}/versand?t=${token}`;

  const internOk = await sendeResend(env.RESEND_API_KEY, {
    from: 'KANID Factory <info@kanid.de>',
    to: [EMPFAENGER],
    reply_to: email,
    subject: `[PayPal] ${daten.bestellnummer} — ${artikel}`,
    text: [
      'PayPal-Zahlung eingegangen (IPN geprüft).',
      '',
      `Transaktion: ${txn}`,
      `Bestellnummer: ${daten.bestellnummer}`,
      `Artikel: ${artikel} × ${menge}`,
      `Summe: ${euro(brutto)}`,
      `Kunde: ${name} <${email}>`,
      daten.strasse ? `Adresse: ${daten.strasse}, ${daten.plz} ${daten.ort}` : null,
      '',
      'Gesetzliche Bestellbestätigung geht an den Kunden.',
      '',
      'DHL Easylog-Importdatei liegt an. In Easylog: Sendungsdatenimport',
      'mit Vorlage „DHL Easylogkonvertiert-Vorlage Sendungsdatenimport“.',
      'Erneut laden:',
      `${versandUrl}&download=1`,
      '',
      'Label-Daten mit Kopierknöpfen:',
      versandUrl,
    ].filter(Boolean).join('\n'),
    attachments: [easylogAnhang(daten)],
  });
  if (!internOk) {
    return new Response('MAIL_FAIL', { status: 500 });
  }

  const anhang = await pdfAnhang();
  const brief = {
    from: 'KANID Factory <info@kanid.de>',
    to: [email],
    subject: `Ihre Bestellung bei KANID — Bestellbestätigung ${daten.bestellnummer}`,
    text: bestellBestaetigungText(daten),
    html: bestellBestaetigungHtml(daten),
  };
  if (anhang) brief.attachments = [anhang];

  const kundeOk = await sendeResend(env.RESEND_API_KEY, brief);
  if (!kundeOk) {
    return new Response('MAIL_FAIL', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    const pfad = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'GET' && (pfad === '/' || pfad === '/ping' || pfad === '/ping.php')) {
      return json({ ok: true, runtime: 'cloudflare-worker', version: 11, time: new Date().toISOString() }, 200, origin);
    }

    if (pfad === '/bestaetigen') {
      return handleBestaetigen(request, env, url);
    }

    if (pfad === '/versand') {
      return handleVersand(request, env, url);
    }

    if (pfad === '/paypal') {
      if (request.method !== 'POST') {
        return new Response('IPN erwartet POST', { status: 405 });
      }
      return handlePaypal(request, env);
    }

    if (request.method !== 'POST') {
      return antwort(request, { ok: false, error: 'method', meldung: 'Nur POST ist erlaubt.' }, 405);
    }

    if (!originErlaubt(origin)) {
      return antwort(request, { ok: false, error: 'origin', meldung: 'Ungültige Herkunft.' }, 403);
    }

    if (pfad === '/bestellung') {
      return handleBestellung(request, env);
    }

    if (herkunftFremd(request)) {
      return verwerfen(request, 'herkunft');
    }

    const ip = clientIp(request);
    if (rateLimitUeberschritten(ip)) {
      console.log(JSON.stringify({ event: 'kontakt_ratelimit', ip: ipKurz(ip) }));
      return antwort(request, { ok: false, error: 'rate', meldung: 'Zu viele Nachrichten. Bitte in ein paar Minuten erneut versuchen.' }, 429);
    }

    const form = await request.formData();
    const honeypot = feld(form.get('bot-field'), 80) + feld(form.get('_gotcha'), 80);
    if (honeypot) {
      return verwerfen(request, 'honeypot');
    }

    // Zeitfeld ist optional, solange die Website es nicht setzt.
    const gesetzt = feld(form.get('_gesetzt'), 20);
    if (/^\d+$/.test(gesetzt)) {
      let wert = Number(gesetzt);
      if (wert > 1e11) wert = Math.floor(wert / 1000); // Millisekunden toleriert
      const alter = Math.floor(Date.now() / 1000) - wert;
      if (alter >= 0 && alter < MIN_SEKUNDEN) {
        return verwerfen(request, 'zu-schnell', { sekunden: alter });
      }
    }

    const name = feld(form.get('name'), 120);
    const firma = feld(form.get('firma'), 160);
    const email = feld(form.get('email'), 180);
    const art = feld(form.get('art'), 40);
    const quelleRoh = feld(form.get('quelle'), 40);
    const kontext = feld(form.get('kontext'), 180);
    const message = typeof form.get('message') === 'string'
      ? form.get('message').replace(/\0/g, '').trim().slice(0, 5000)
      : '';

    const artEintrag = ARTEN[art];
    const quelle = QUELLEN.has(quelleRoh) ? quelleRoh : '';

    if (!name || !firma || !email || !artEintrag || !message) {
      return antwort(request, { ok: false, error: 'validation', meldung: 'Bitte füllen Sie alle Pflichtfelder aus.' }, 422);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return antwort(request, { ok: false, error: 'validation', meldung: 'Bitte geben Sie eine gültige E-Mail-Adresse ein.' }, 422);
    }

    const turnstile = await pruefeTurnstile(feld(form.get('cf-turnstile-response'), 2048), ip, env);
    console.log(JSON.stringify({
      event: 'kontakt_turnstile',
      ok: turnstile.ok,
      grund: turnstile.grund,
      codes: turnstile.codes,
      erzwingen: TURNSTILE_ERZWINGEN,
      ip: ipKurz(ip),
    }));
    if (!turnstile.ok && TURNSTILE_ERZWINGEN && turnstile.grund !== 'fehler-siteverify') {
      return verwerfen(request, `turnstile-${turnstile.grund}`);
    }

    const gruende = spamGruende({ name, firma, message });
    if (gruende.length) {
      return verwerfen(request, gruende.join(','), {
        domain: (email.split('@')[1] || '').toLowerCase(),
        laenge: message.length,
      });
    }

    if (!env.RESEND_API_KEY) {
      return antwort(request, {
        ok: false,
        error: 'config',
        meldung: 'Der Versand ist noch nicht eingerichtet (kein RESEND_API_KEY).',
      }, 500);
    }

    const mailBetreff = kontext
      ? `[${artEintrag.tag}] ${firma} — ${kontext}`
      : `[${artEintrag.tag}] ${firma}`;

    const intern = [
      'Neue Nachricht über das Kontaktformular auf kanid.de',
      '',
      `Firma:   ${firma}`,
      `Name:    ${name}`,
      `E-Mail:  ${email}`,
      `Art:     ${artEintrag.label}`,
      quelle ? `Quelle:  ${quelle}` : null,
      kontext ? `Kontext: ${kontext}` : null,
      `IP:      ${ip || 'unbekannt'}${request.cf?.country ? ` (${request.cf.country})` : ''}`,
      `Zeit:    ${new Date().toISOString()} UTC`,
      `Bot-Check: ${turnstile.ok ? 'Turnstile ok' : `Turnstile ${turnstile.grund}`}`,
      '',
      'Nachricht:',
      message,
    ].filter((zeile) => zeile !== null).join('\n');

    const internOk = await sendeResend(env.RESEND_API_KEY, {
      from: 'KANID Kontaktformular <info@kanid.de>',
      to: [EMPFAENGER],
      reply_to: email,
      subject: mailBetreff,
      text: intern,
    });

    if (!internOk) {
      return antwort(request, {
        ok: false,
        error: 'mail',
        meldung: 'Die Nachricht konnte nicht versendet werden. Bitte schreiben Sie direkt an info@kanid.de.',
      }, 500);
    }

    const bestaetigung = [
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
    ].filter((zeile) => zeile !== null).join('\n');

    await sendeResend(env.RESEND_API_KEY, {
      from: 'KANID <info@kanid.de>',
      to: [email],
      subject: 'Ihre Nachricht an KANID',
      text: bestaetigung,
      html: bestaetigungHtml(),
    });

    return antwort(request, { ok: true, mail: true }, 200);
  },
};