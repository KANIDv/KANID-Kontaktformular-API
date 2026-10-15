// Cloudflare Worker — in die Oberflaeche einfuegen:
// dash.cloudflare.com → Workers & Pages → kanid-kontakt → Edit code
//
// Secret: RESEND_API_KEY
//
// v12 (2026-10, Branch widerruf-online-2026-10):
//   - POST /widerruf: elektronische Widerrufsfunktion nach Paragraph 356a BGB
//     (Eingangsbestaetigung an den Verbraucher mit Inhalt, Datum und Uhrzeit,
//     Kopie an info@kanid.de). Texte aus kanid-dokumente
//     agb-2026-10/Widerrufsbutton_Texte.md.
//   - Bestellbestaetigung: Belehrungssatz zur Online-Widerrufsfunktion.
// v13 (2026-10-11, Branch widerruf-ip-gewaehr-2026-10):
//   - Widerruf: IP-Adresse nur noch fuer das Rate-Limit, nicht mehr in der
//     Mail an KANID und nicht im Log-Eintrag des Eingangs (Datenschutz 3.2c).
//   - Bestellbestaetigung (PayPal-IPN und /bestaetigen): harmonisierte
//     EU-Mitteilung zur gesetzlichen Gewaehrleistung (VO (EU) 2025/1960) als
//     PDF-Anhang und Bild in der HTML-Mail.
//   - Kontaktformular: unveraendert (die Zustimmung zum vorzeitigen
//     Leistungsbeginn gehoert zum Vertragsschluss, nicht zur Anfrage).
//   - Staging: Variable STAGING = "1" (nur am Skript kanid-kontakt-staging).
//     Dann gehen ALLE Mails ausschliesslich an info@kanid.de mit "[TEST]" im
//     Betreff, Turnstile wird nur protokolliert, und ohne RESEND_API_KEY
//     werden Mails nicht versendet, sondern in der Antwort zurueckgegeben
//     (Trockenlauf). Am Produktiv-Skript ist STAGING nicht gesetzt — dort
//     aendert sich am Verhalten der bestehenden Wege nichts.

const ERLAUBT = [
  'https://kanid.de',
  'https://www.kanid.de',
];

const ERLAUBT_SUFFIX = '.app-ionos.space';
const EMPFAENGER = 'info@kanid.de';
const DANKE = 'https://kanid.de/danke';

const ARTEN = {
  konstruktion: { tag: 'Konstruktion', label: 'Konstruktionskapazität' },
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
    return Response.redirect(data.weiter || dankeFuer(origin), 303);
  }
  const text = data.meldung || 'Die Nachricht konnte nicht gesendet werden.';
  return new Response(
    `<!DOCTYPE html><html lang="de"><meta charset="UTF-8"><title>Fehler</title><p>${text}</p><p><a href="https://kanid.de/#kontakt">Zurück</a></p>`,
    { status, headers: { ...corsHeaders(origin), 'Content-Type': 'text/html; charset=UTF-8' } },
  );
}

// Danke-Seite der Website, von der das Formular kam (Staging landet auf Staging).
function seitenOrigin(origin, request) {
  let o = origin || '';
  if (!o && request) {
    try { o = new URL(request.headers.get('Referer') || '').origin; } catch { o = ''; }
  }
  return o && originErlaubt(o) ? o : 'https://kanid.de';
}

function dankeFuer(origin) {
  const o = seitenOrigin(origin);
  return o === 'https://kanid.de' ? DANKE : `${o}/danke/`;
}

function istStaging(env) {
  return !!env && env.STAGING === '1';
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

// Einziger Versandweg. Produktion: unveraendert sendeResend. Staging: nur an
// info@kanid.de, Betreff mit [TEST]; ohne API-Key Trockenlauf.
async function sende(env, brief, trockenlauf) {
  if (istStaging(env)) {
    const original = Array.isArray(brief.to) ? brief.to.join(', ') : String(brief.to || '');
    brief = {
      ...brief,
      to: [EMPFAENGER],
      subject: `[TEST] ${String(brief.subject || '').replace(/^\[TEST\]\s*/, '')}`,
      headers: { ...(brief.headers || {}), 'X-KANID-Staging-Urspruenglich-an': original },
    };
    if (!env.RESEND_API_KEY) {
      console.log(JSON.stringify({ event: 'staging_trockenlauf', subject: brief.subject, original }));
      if (trockenlauf) trockenlauf.push({ an: brief.to, urspruenglich_an: original, betreff: brief.subject, text: brief.text, html: brief.html || null });
      return true;
    }
  }
  return sendeResend(env.RESEND_API_KEY, brief);
}

function versandBereit(env) {
  return !!env.RESEND_API_KEY || istStaging(env);
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

mittels einer eindeutigen Erklärung (z. B. ein mit der Post versandter Brief oder eine E-Mail) über Ihren Entschluss, diesen Vertrag zu widerrufen, informieren. Sie können dafür das beigefügte Muster-Widerrufsformular verwenden, das jedoch nicht vorgeschrieben ist. Sie können Ihr Widerrufsrecht auch online unter https://kanid.de/widerruf/online/ ausüben. Wenn Sie diese Online-Funktion nutzen, übermitteln wir Ihnen auf einem dauerhaften Datenträger (z. B. durch eine E-Mail) unverzüglich eine Eingangsbestätigung mit Informationen zum Inhalt der Widerrufserklärung sowie dem Datum und der Uhrzeit ihres Eingangs.

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
    EU_GEWAEHR_TEXT,
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
            <td style="padding:0 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#0e2733;">
              <strong style="color:#003399;">Ihre gesetzlichen Gewährleistungsrechte</strong><br>
              <a href="${EU_GEWAEHR_PNG}" style="display:block;margin:10px 0 8px;border:1px solid #d5dadd;"><img src="${EU_GEWAEHR_PNG}" width="550" alt="EU-Mitteilung Gesetzliche Gewährleistung: mindestens zwei Jahre gesetzliche Gewährleistung der Vertragsmäßigkeit für Waren, die in der EU verkauft werden. Die vollständige Mitteilung liegt dieser E-Mail als PDF bei." style="display:block;width:100%;max-width:550px;height:auto;border:0;"></a>
              Die Mitteilung liegt außerdem als PDF bei. Mehr zu Ihren Rechten: <a href="https://europa.eu/youreurope/garantien" style="color:#003399;">europa.eu/youreurope/garantien</a>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 28px;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.55;color:#21262a;">
              Das Muster-Widerrufsformular und die EU-Mitteilung zur gesetzlichen Gewährleistung liegen als PDF bei.<br>
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

// Harmonisierte EU-Mitteilung zur gesetzlichen Gewaehrleistung (VO (EU)
// 2025/1960 Anhang I, offizielle deutsche Farbfassung). Seit 27.09.2026 vor
// Vertragsschluss Pflicht; die Kommission empfiehlt sie auch in der
// Bestaetigungs-Mail (Practical Guidelines Ziff. 2.3). Sie liegt deshalb als
// PDF bei (dauerhafter Datentraeger) und steht als Bild in der HTML-Mail.
const EU_GEWAEHR_PNG = 'https://kanid.de/assets/eu/gesetzliche-gewaehrleistung-eu-mitteilung.png';
const EU_GEWAEHR_PDF = 'https://kanid.de/assets/eu/gesetzliche-gewaehrleistung-eu-mitteilung.pdf';
const EU_GEWAEHR_TEXT = `Ihre gesetzlichen Gewährleistungsrechte

Die harmonisierte EU-Mitteilung „Gesetzliche Gewährleistung“ liegt dieser E-Mail als PDF bei (gesetzliche-gewaehrleistung-eu-mitteilung.pdf). Mehr zu Ihren Rechten: https://europa.eu/youreurope/garantien`;

async function dateiAnhang(url, filename) {
  try {
    const antwort = await fetch(url);
    if (!antwort.ok) return null;
    const bytes = new Uint8Array(await antwort.arrayBuffer());
    let bin = '';
    for (let i = 0; i < bytes.length; i += 1) bin += String.fromCharCode(bytes[i]);
    return { filename, content: btoa(bin) };
  } catch (fehler) {
    return null;
  }
}

async function bestellAnhaenge() {
  const liste = await Promise.all([
    pdfAnhang(),
    dateiAnhang(EU_GEWAEHR_PDF, 'gesetzliche-gewaehrleistung-eu-mitteilung.pdf'),
  ]);
  return liste.filter(Boolean);
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

  const anhaenge = await bestellAnhaenge();
  const brief = {
    from: 'KANID Factory <info@kanid.de>',
    to: [daten.email],
    bcc: [EMPFAENGER],
    subject: `Ihre Bestellung bei KANID — Bestellbestätigung ${daten.bestellnummer}`,
    text: bestellBestaetigungText(daten),
    html: bestellBestaetigungHtml(daten),
  };
  if (anhaenge.length) brief.attachments = anhaenge;

  const ok = await sende(env, brief);
  if (!ok) {
    return new Response(htmlSeite('Fehler', '<p>Die Bestätigung konnte nicht gesendet werden. Resend prüfen.</p>'), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=UTF-8' },
    });
  }

  return new Response(htmlSeite('Gesendet', `
    <p class="mono">Erledigt</p>
    <h1>Bestellbestätigung ist raus.</h1>
    <p>An ${htmlEsc(daten.email)}, Kopie an ${htmlEsc(EMPFAENGER)}. Widerrufsformular und EU-Gewährleistungsmitteilung liegen als PDF bei, soweit der Abruf von kanid.de geklappt hat.</p>
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

  const internOk = await sende(env, {
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

  await sende(env, {
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

  const internOk = await sende(env, {
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

  const anhaenge = await bestellAnhaenge();
  const brief = {
    from: 'KANID Factory <info@kanid.de>',
    to: [email],
    subject: `Ihre Bestellung bei KANID — Bestellbestätigung ${daten.bestellnummer}`,
    text: bestellBestaetigungText(daten),
    html: bestellBestaetigungHtml(daten),
  };
  if (anhaenge.length) brief.attachments = anhaenge;

  const kundeOk = await sende(env, brief);
  if (!kundeOk) {
    return new Response('MAIL_FAIL', { status: 500 });
  }

  return new Response('OK', { status: 200 });
}

// ---- Elektronische Widerrufsfunktion (Paragraph 356a BGB, v12) -------------
// Abs. 2: Name, Angaben zur Identifizierung des Vertrags, elektronisches
// Kommunikationsmittel (E-Mail) fuer die Eingangsbestaetigung.
// Abs. 4: unverzueglich Eingangsbestaetigung auf dauerhaftem Datentraeger mit
// dem Inhalt der Erklaerung sowie Datum und Uhrzeit des Eingangs.
// Spamschutz bewusst milder als beim Kontaktformular: Ein verworfener echter
// Widerruf waere ein Rechtsproblem. Herkunft und Honeypot wie gehabt, eigenes
// Ratenlimit, Turnstile wird nur protokolliert, kein Inhaltsfilter.
// Texte 1:1 aus kanid-dokumente/ausgabe/agb-2026-10/Widerrufsbutton_Texte.md
// (Abschnitte 2, 4 und 5), Stand 10/2026.
const WIDERRUF_VERTRAEGE = {
  waren: 'Bestellung im Factory-Shop',
  dienstleistung: 'Produktentwicklung (Phase 1, Phase 2 oder Zusatzleistung)',
};
const WIDERRUF_ERKLAERUNG = 'Hiermit widerrufe ich den oben bezeichneten Vertrag bzw. den oben bezeichneten Teil des Vertrags.';
const WIDERRUF_RATE_MAX = 5;
const widerrufRate = new Map();

function widerrufRateUeberschritten(ip) {
  if (!ip) return false;
  const jetzt = Date.now();
  const liste = (widerrufRate.get(ip) || []).filter((t) => t > jetzt - RATE_FENSTER_MS);
  if (liste.length >= WIDERRUF_RATE_MAX) {
    widerrufRate.set(ip, liste);
    return true;
  }
  liste.push(jetzt);
  widerrufRate.set(ip, liste);
  if (widerrufRate.size > 5000) widerrufRate.clear();
  return false;
}

// Eingangszeit serverseitig in Europe/Berlin; dieselben Werte gehen in die
// E-Mail und (ueber die JSON-Antwort) auf die Bestaetigungsseite.
function zeitBerlin(datum) {
  const teile = Object.fromEntries(new Intl.DateTimeFormat('de-DE', {
    timeZone: 'Europe/Berlin',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    timeZoneName: 'short',
  }).formatToParts(datum).map((p) => [p.type, p.value]));
  const tag = `${teile.day}.${teile.month}.${teile.year}`;
  const uhrzeit = `${teile.hour}:${teile.minute}`;
  const zone = teile.timeZoneName || '';
  return { tag, uhrzeit, sekunden: `${uhrzeit}:${teile.second}`, zone,
    text: `${tag} um ${uhrzeit} Uhr${zone ? ` (${zone})` : ''}` };
}

function widerrufKennung(datum) {
  const tag = datum.toISOString().slice(0, 10).replace(/-/g, '');
  const zufall = [...crypto.getRandomValues(new Uint8Array(3))].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `WR-${tag}-${zufall}`;
}

function widerrufVertragZeile(d) {
  return [d.vertragLabel, d.kennung, d.datum ? `bestellt bzw. beauftragt am ${d.datum}` : '']
    .filter(Boolean).join(', ');
}

// Inhalt der Erklaerung (§ 356a Abs. 2/4), Reihenfolge wie im Mustertext.
function widerrufInhalt(d, fuerKunde) {
  const nachricht = fuerKunde ? d.nachrichtKunde : d.nachricht;
  return [
    ['Name', d.name],
    ['Vertrag', widerrufVertragZeile(d)],
    ['Umfang', d.umfangText],
    ['E-Mail-Adresse für diese Bestätigung', d.email],
    ...(d.anschrift ? [['Anschrift', d.anschrift]] : []),
    ...(nachricht ? [['Nachricht', nachricht]] : []),
  ];
}

function widerrufBetreff(d) {
  return `Eingangsbestätigung Ihres Widerrufs – ${d.kennung || `Vertrag vom ${d.datum}`}`;
}

const WIDERRUF_SIGNATUR = [
  'Mit freundlichen Grüßen',
  'KANID UG (haftungsbeschränkt)',
  'Heinrich-Hertz-Str. 11 · 70794 Filderstadt',
  'info@kanid.de · +49 1520 7921611',
];

function widerrufText(d, fuerKunde) {
  const inhalt = widerrufInhalt(d, fuerKunde).map(([k, v]) => `${k}: ${v}`);
  if (fuerKunde) {
    return [
      `Guten Tag ${d.name},`,
      '',
      'wir bestätigen den Eingang Ihres Widerrufs.',
      '',
      `Eingegangen am: ${d.zeit.tag} um ${d.zeit.uhrzeit} Uhr (${d.zeit.zone})`,
      'Über: Online-Widerrufsfunktion auf kanid.de',
      '',
      'Inhalt Ihrer Widerrufserklärung:',
      `„${WIDERRUF_ERKLAERUNG}“`,
      ...inhalt,
      '',
      'Die Folgen des Widerrufs richten sich nach unserer Widerrufsbelehrung: https://kanid.de/widerruf/',
      '',
      'Bei einer Bestellung im Factory-Shop senden Sie die Ware bitte innerhalb von vierzehn Tagen ab heute an uns zurück:',
      'KANID UG (haftungsbeschränkt), Heinrich-Hertz-Str. 11, 70794 Filderstadt',
      '',
      ...WIDERRUF_SIGNATUR,
    ].join('\n');
  }
  return [
    'Widerruf über die Online-Widerrufsfunktion auf kanid.de (§ 356a BGB)',
    '',
    `Eingegangen am: ${d.zeit.tag} um ${d.zeit.sekunden} Uhr (${d.zeit.zone})`,
    `Eingang (UTC): ${d.eingangUtc}`,
    `Vorgangsnummer: ${d.id}`,
    '',
    'Inhalt der Widerrufserklärung:',
    `„${WIDERRUF_ERKLAERUNG}“`,
    ...inhalt,
    '',
    `Bot-Check: ${d.turnstile}`,
    `Herkunft: ${d.herkunft}`,
    `Eingangsbestätigung an Kunde: ${d.kundeOk === undefined ? 'wird automatisch versendet' : (d.kundeOk ? 'versendet' : 'FEHLGESCHLAGEN — bitte manuell bestätigen')}`,
  ].join('\n');
}

function widerrufHtml(d) {
  const p = (inhalt, extra = '') => `<tr><td style="padding:0 24px 16px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#21262a;${extra}">${inhalt}</td></tr>`;
  const zeilen = widerrufInhalt(d, true).map(([k, v]) => `<tr>
      <td style="padding:8px 12px;border:1px solid #0e2733;font-family:Consolas,'Courier New',monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#1b6ba4;vertical-align:top;width:38%;">${htmlEsc(k)}</td>
      <td style="padding:8px 12px;border:1px solid #0e2733;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.45;color:#0e2733;vertical-align:top;">${htmlZeilen(v)}</td>
    </tr>`).join('');
  return `<!DOCTYPE html>
<html lang="de">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${htmlEsc(widerrufBetreff(d))}</title></head>
<body style="margin:0;padding:0;background:#e9ecee;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#e9ecee" style="background:#e9ecee;">
    <tr><td align="center" style="padding:32px 12px;">
      <table role="presentation" width="600" cellpadding="0" cellspacing="0" bgcolor="#ffffff" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #0e2733;border-collapse:collapse;">
        <tr><td style="padding:22px 24px 18px;border-bottom:1px solid #0e2733;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
            <td width="220" style="vertical-align:middle;"><img src="https://kanid.de/assets/img/LOGO.png" width="176" height="48" alt="KANID" style="display:block;width:176px;height:auto;border:0;"></td>
            <td align="right" style="vertical-align:middle;font-family:Consolas,'Courier New',monospace;font-size:11px;letter-spacing:0.1em;text-transform:uppercase;color:#1b6ba4;line-height:1.55;">Eingangsbestätigung<br>Widerruf</td>
          </tr></table>
        </td></tr>
        <tr><td style="height:24px;"></td></tr>
        ${p(`Guten Tag ${htmlEsc(d.name)},<br><br>wir bestätigen den Eingang Ihres Widerrufs.`)}
        ${p(`<strong style="color:#0e2733;">Eingegangen am: ${htmlEsc(d.zeit.tag)} um ${htmlEsc(d.zeit.uhrzeit)} Uhr (${htmlEsc(d.zeit.zone)})</strong><br>Über: Online-Widerrufsfunktion auf kanid.de`)}
        ${p(`Inhalt Ihrer Widerrufserklärung:<br><strong style="color:#0e2733;">„${htmlEsc(WIDERRUF_ERKLAERUNG)}“</strong>`, 'padding-bottom:10px;')}
        <tr><td style="padding:0 24px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">${zeilen}</table>
        </td></tr>
        ${p('Die Folgen des Widerrufs richten sich nach unserer Widerrufsbelehrung: <a href="https://kanid.de/widerruf/" style="color:#1b6ba4;">https://kanid.de/widerruf/</a>')}
        ${p('Bei einer Bestellung im Factory-Shop senden Sie die Ware bitte innerhalb von vierzehn Tagen ab heute an uns zurück:<br>KANID UG (haftungsbeschränkt), Heinrich-Hertz-Str. 11, 70794 Filderstadt')}
        ${p(`Mit freundlichen Grüßen<br><strong style="color:#0e2733;">KANID UG (haftungsbeschränkt)</strong><br>Heinrich-Hertz-Str. 11 · 70794 Filderstadt<br>info@kanid.de · +49 1520 7921611`, 'padding-bottom:28px;')}
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

async function handleWiderruf(request, env) {
  const origin = request.headers.get('Origin') || '';
  const site = seitenOrigin(origin, request);
  if (herkunftFremd(request)) {
    return antwort(request, { ok: false, error: 'origin', meldung: 'Ungültige Herkunft.' }, 403);
  }
  const ip = clientIp(request);
  if (widerrufRateUeberschritten(ip)) {
    console.log(JSON.stringify({ event: 'widerruf_ratelimit', ip: ipKurz(ip) }));
    return antwort(request, { ok: false, error: 'rate', meldung: 'Zu viele Übermittlungen in kurzer Zeit. Bitte versuchen Sie es in einigen Minuten erneut oder senden Sie Ihren Widerruf per E-Mail an info@kanid.de.' }, 429);
  }

  const form = await request.formData();
  const honeypot = feld(form.get('bot-field'), 80) + feld(form.get('_gotcha'), 80);
  if (honeypot) {
    console.log(JSON.stringify({ event: 'widerruf_verworfen', grund: 'honeypot', ip: ipKurz(ip) }));
    return antwort(request, { ok: true, mail: true }, 200);
  }

  const lang = (k, max) => (typeof form.get(k) === 'string' ? form.get(k).replace(/\0/g, '').trim().slice(0, max) : '');
  const name = feld(form.get('name'), 120);
  const email = feld(form.get('email'), 180);
  const vertrag = feld(form.get('vertrag'), 20);
  const kennung = feld(form.get('kennung'), 120);
  const datum = feld(form.get('datum'), 40);
  const umfang = feld(form.get('umfang'), 10) === 'teil' ? 'teil' : 'ganz';
  const umfangTeil = lang('umfang_teil', 1000);
  const anschrift = lang('anschrift', 400);
  const nachricht = lang('nachricht', 2000);
  const vertragLabel = WIDERRUF_VERTRAEGE[vertrag];

  if (!name || !email || !vertragLabel) {
    return antwort(request, { ok: false, error: 'validation', meldung: 'Bitte geben Sie Ihren Namen, Ihre E-Mail-Adresse und den Vertrag an, den Sie widerrufen möchten.' }, 422);
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return antwort(request, { ok: false, error: 'validation', meldung: 'Bitte geben Sie eine gültige E-Mail-Adresse ein — an sie geht Ihre Eingangsbestätigung.' }, 422);
  }
  if (!kennung && !datum) {
    return antwort(request, { ok: false, error: 'validation', meldung: 'Bitte geben Sie die Bestell- oder Angebotsnummer oder das Datum der Bestellung bzw. des Auftrags an.' }, 422);
  }
  if (umfang === 'teil' && !umfangTeil) {
    return antwort(request, { ok: false, error: 'validation', meldung: 'Bitte nennen Sie die Artikel bzw. Leistungen, die Sie widerrufen möchten, oder wählen Sie „Ganzer Vertrag“.' }, 422);
  }

  const turnstile = await pruefeTurnstile(feld(form.get('cf-turnstile-response'), 2048), ip, env);

  if (!versandBereit(env)) {
    return antwort(request, { ok: false, error: 'config', meldung: 'Die Übermittlung ist gerade nicht möglich. Bitte senden Sie Ihren Widerruf per E-Mail an info@kanid.de.' }, 500);
  }

  const eingang = new Date();
  const linkFrei = (wert) => (!wert ? '' : (LINK_MUSTER.test(wert)
    ? '[Enthält Links und wird hier aus Sicherheitsgründen nicht wiederholt. Liegt uns vollständig vor.]'
    : wert));
  const d = {
    id: widerrufKennung(eingang),
    eingangUtc: eingang.toISOString(),
    zeit: zeitBerlin(eingang),
    name, email, vertrag, vertragLabel, kennung, datum, umfang, anschrift, nachricht,
    umfangText: umfang === 'teil' ? `Teil: ${umfangTeil}` : 'ganzer Vertrag',
    nachrichtKunde: linkFrei(nachricht),
    turnstile: turnstile.ok ? 'Turnstile ok' : `Turnstile ${turnstile.grund} (nicht erzwungen)`,
    herkunft: site,
  };
  const trockenlauf = istStaging(env) ? [] : null;

  // Kopie an KANID zur internen Bearbeitung
  const internOk = await sende(env, {
    from: 'KANID Widerruf <info@kanid.de>',
    to: [EMPFAENGER],
    reply_to: email,
    subject: `[Widerruf] ${d.id} — ${vertragLabel} — ${name}`,
    text: widerrufText(d, false),
  }, trockenlauf);
  if (!internOk) {
    console.log(JSON.stringify({ event: 'widerruf_mail_fehler', id: d.id }));
    return antwort(request, { ok: false, error: 'mail', meldung: 'Ihr Widerruf konnte gerade nicht übermittelt werden. Bitte senden Sie ihn per E-Mail an info@kanid.de oder versuchen Sie es erneut.' }, 500);
  }

  // Eingangsbestaetigung (§ 356a Abs. 4), automatisch und sofort
  const kundeOk = await sende(env, {
    from: 'KANID <info@kanid.de>',
    to: [email],
    reply_to: EMPFAENGER,
    subject: widerrufBetreff(d),
    text: widerrufText(d, true),
    html: widerrufHtml(d),
  }, trockenlauf);
  if (!kundeOk) {
    await sende(env, {
      from: 'KANID Widerruf <info@kanid.de>',
      to: [EMPFAENGER],
      subject: `[Widerruf] ${d.id} — Eingangsbestätigung an ${email} FEHLGESCHLAGEN`,
      text: widerrufText({ ...d, kundeOk: false }, false),
    }, trockenlauf);
  }
  // Datenminimierung (Datenschutzerklaerung 3.2c, Stand 10/2026): Die IP dient
  // nur der Missbrauchsabwehr (Rate-Limit oben) und wird NICHT mit der
  // Erklaerung gespeichert — weder in der Mail noch in diesem Log-Eintrag.
  console.log(JSON.stringify({ event: 'widerruf_eingang', id: d.id, vertrag, umfang, kundeOk, turnstile: turnstile.grund }));

  const weiter = `${site}/widerruf/online/eingegangen/?id=${encodeURIComponent(d.id)}&t=${encodeURIComponent(d.eingangUtc)}${kundeOk ? '' : '&b=0'}`;
  const daten = {
    ok: true, mail: true, id: d.id, eingang: d.eingangUtc, eingang_text: d.zeit.text,
    eingang_datum: d.zeit.tag, eingang_uhrzeit: d.zeit.uhrzeit,
    bestaetigung: kundeOk, weiter,
    // fuer die Bestaetigungsseite ("Ihre Angaben"); bleibt im sessionStorage des Browsers
    angaben: { name, email, vertrag: widerrufVertragZeile(d), umfang: d.umfangText },
  };
  if (trockenlauf) daten.staging_trockenlauf = trockenlauf;
  return antwort(request, daten, 200);
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
      return json({ ok: true, runtime: 'cloudflare-worker', version: 13, time: new Date().toISOString() }, 200, origin);
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

    if (pfad === '/widerruf') {
      return handleWiderruf(request, env);
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
    const GEFUNDEN = {
      google: 'Google-Suche', maps: 'Google Maps / Unternehmensprofil', ki: 'ChatGPT / KI-Assistent',
      linkedin: 'LinkedIn', youtube: 'YouTube / Shorts', 'instagram-tiktok': 'Instagram / TikTok',
      empfehlung: 'Empfehlung', veranstaltung: 'Veranstaltung / Netzwerk', factory: 'Über ein Factory-Produkt',
      sonstiges: 'Sonstiges',
    };
    const gefunden = GEFUNDEN[feld(form.get('gefunden'), 40)] || '';
    const utm = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']
      .map((k) => [k.slice(4), feld(form.get(k), 80)])
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${v}`)
      .join(' · ');
    const einstieg = feld(form.get('einstieg'), 120);
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
    if (!turnstile.ok && TURNSTILE_ERZWINGEN && !istStaging(env) && turnstile.grund !== 'fehler-siteverify') {
      return verwerfen(request, `turnstile-${turnstile.grund}`);
    }

    const gruende = spamGruende({ name, firma, message });
    if (gruende.length) {
      return verwerfen(request, gruende.join(','), {
        domain: (email.split('@')[1] || '').toLowerCase(),
        laenge: message.length,
      });
    }

    if (!versandBereit(env)) {
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
      `Gefunden: ${gefunden || 'keine Angabe'}`,
      utm ? `UTM:     ${utm}` : null,
      einstieg ? `Einstieg: ${einstieg}` : null,
      `IP:      ${ip || 'unbekannt'}${request.cf?.country ? ` (${request.cf.country})` : ''}`,
      `Zeit:    ${new Date().toISOString()} UTC`,
      `Bot-Check: ${turnstile.ok ? 'Turnstile ok' : `Turnstile ${turnstile.grund}`}`,
      '',
      'Nachricht:',
      message,
    ].filter((zeile) => zeile !== null).join('\n');

    const internOk = await sende(env, {
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

    await sende(env, {
      from: 'KANID <info@kanid.de>',
      to: [email],
      subject: 'Ihre Nachricht an KANID',
      text: bestaetigung,
      html: bestaetigungHtml(),
    });

    return antwort(request, { ok: true, mail: true }, 200);
  },
};