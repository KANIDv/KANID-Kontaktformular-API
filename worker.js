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

function zelle(label, wert, extra) {
  return `<td style="padding:10px 12px;border-left:1px solid #0e2733;vertical-align:top;${extra || ''}">
    <div style="margin:0 0 4px;font-family:Consolas,'Courier New',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#1b6ba4;">${label}</div>
    <div style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.35;color:#0e2733;font-weight:500;">${wert}</div>
  </td>`;
}

function bestaetigungHtml({ name, firma, artLabel, kontext, message }) {
  const heute = new Date();
  const stand = heute.toISOString().slice(0, 7);
  const datum = heute.toISOString().slice(0, 10);
  const nummer = `KANID-MAIL-${datum.replace(/-/g, '')}`;
  const bezug = kontext ? htmlEsc(kontext) : '—';

  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Eingangsbestätigung</title>
</head>
<body style="margin:0;padding:0;background:#e9ecee;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#e9ecee;">
    <tr>
      <td align="center" style="padding:28px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #0e2733;">
          <tr>
            <td style="padding:8px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #c9d0d4;">

                <tr>
                  <td style="padding:20px 22px 16px;border-bottom:1px solid #0e2733;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="vertical-align:middle;">
                          <img src="https://kanid.de/assets/img/LOGO.png" width="168" alt="KANID" style="display:block;width:168px;height:auto;border:0;">
                        </td>
                        <td align="right" style="vertical-align:middle;font-family:Consolas,'Courier New',monospace;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#1b6ba4;line-height:1.5;">
                          Eingangsbestätigung<br>
                          Blatt 01 / 01
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:28px 22px 8px;font-family:Consolas,'Courier New',monospace;font-size:11px;letter-spacing:0.14em;text-transform:uppercase;color:#1b6ba4;">
                    Nachricht eingegangen
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 22px 18px;font-family:Arial,Helvetica,sans-serif;font-size:26px;line-height:1.2;font-weight:700;color:#0e2733;">
                    Wir haben Ihre Anfrage erhalten.
                  </td>
                </tr>
                <tr>
                  <td style="padding:0 22px 22px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#21262a;">
                    Guten Tag ${htmlEsc(name)},<br><br>
                    vielen Dank für Ihre Nachricht an KANID. Sie ist bei uns eingegangen.
                    Diese E-Mail bestätigt nur den Empfang — sie ist keine Auftragsbestätigung
                    und kein Angebot.
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 22px 22px;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #0e2733;border-collapse:collapse;">
                      <tr>
                        ${zelle('Firma', htmlEsc(firma), 'border-left:0;width:50%;')}
                        ${zelle('Ansprechpartner', htmlEsc(name), 'width:50%;')}
                      </tr>
                      <tr>
                        ${zelle('Art der Anfrage', htmlEsc(artLabel), 'border-left:0;border-top:1px solid #0e2733;')}
                        ${zelle('Bezug', bezug, 'border-top:1px solid #0e2733;')}
                      </tr>
                      <tr>
                        <td colspan="2" style="padding:10px 12px 14px;border-top:1px solid #0e2733;">
                          <div style="margin:0 0 6px;font-family:Consolas,'Courier New',monospace;font-size:10px;letter-spacing:0.12em;text-transform:uppercase;color:#1b6ba4;">Mitteilung</div>
                          <div style="margin:0;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;color:#0e2733;">${htmlZeilen(message)}</div>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 22px 26px;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.55;color:#21262a;">
                    Wir antworten werktags innerhalb weniger Stunden.
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 22px 28px;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#0e2733;">
                    Mit freundlichen Grüßen<br>
                    <strong>Konstantin Vinogradov</strong><br>
                    <span style="font-size:13px;color:#21262a;">Geschäftsführer</span>
                  </td>
                </tr>

                <tr>
                  <td style="padding:0 22px 22px;border-top:1px solid #c9d0d4;">
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="padding-top:20px;vertical-align:top;width:150px;">
                          <img src="https://kanid.de/assets/img/LOGO.png" width="132" alt="KANID" style="display:block;width:132px;height:auto;border:0;">
                        </td>
                        <td style="padding-top:20px;font-family:Arial,Helvetica,sans-serif;font-size:13px;line-height:1.55;color:#0e2733;">
                          <strong>KANID UG (haftungsbeschränkt)</strong><br>
                          Geschäftsführer: Konstantin Vinogradov<br>
                          Heinrich-Hertz-Str. 11<br>
                          70794 Filderstadt<br>
                          Handelsregister: HRB 798044<br>
                          Telefon: <a href="tel:+4915207921611" style="color:#1b6ba4;text-decoration:none;">+49 1520 7921611</a><br>
                          E-Mail: <a href="mailto:info@kanid.de" style="color:#1b6ba4;text-decoration:none;">info@kanid.de</a><br>
                          Web: <a href="https://kanid.de" style="color:#1b6ba4;text-decoration:none;">kanid.de</a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>

                <tr>
                  <td>
                    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid #0e2733;border-collapse:collapse;font-family:Consolas,'Courier New',monospace;color:#0e2733;">
                      <tr>
                        ${zelle('KANID UG', 'Filderstadt', 'border-left:0;width:28%;')}
                        ${zelle('Blatt', '01 / 01', 'width:18%;')}
                        ${zelle('Stand', stand, 'width:18%;')}
                        ${zelle('Maßstab', '1:1', 'width:18%;')}
                      </tr>
                      <tr>
                        ${zelle('Benennung', 'Eingangsbestätigung Kontakt', 'border-left:0;border-top:1px solid #0e2733;width:50%;')}
                        ${zelle('Zeichnungsnummer', nummer, 'border-top:1px solid #0e2733;width:50%;')}
                      </tr>
                      <tr>
                        ${zelle('Bearbeiter', 'K. Vinogradov', 'border-left:0;border-top:1px solid #0e2733;')}
                        ${zelle('Werkstoff / Norm', 'HTML · E-Mail', 'border-top:1px solid #0e2733;')}
                      </tr>
                    </table>
                  </td>
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/ping' || url.pathname === '/ping.php')) {
      return json({ ok: true, runtime: 'cloudflare-worker', version: 3, time: new Date().toISOString() }, 200, origin);
    }

    if (request.method !== 'POST') {
      return antwort(request, { ok: false, error: 'method', meldung: 'Nur POST ist erlaubt.' }, 405);
    }

    if (!originErlaubt(origin)) {
      return antwort(request, { ok: false, error: 'origin', meldung: 'Ungültige Herkunft.' }, 403);
    }

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
      `Guten Tag ${name},`,
      '',
      'wir haben Ihre Nachricht erhalten. Diese E-Mail bestätigt nur den Eingang — sie ist keine Auftragsbestätigung.',
      '',
      `Firma:     ${firma}`,
      `Art:       ${artEintrag.label}`,
      kontext ? `Bezug:     ${kontext}` : null,
      '',
      'Ihre Nachricht:',
      message,
      '',
      'Wir antworten werktags innerhalb weniger Stunden.',
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
      html: bestaetigungHtml({
        name,
        firma,
        artLabel: artEintrag.label,
        kontext,
        message,
      }),
    });

    return antwort(request, { ok: true, mail: true }, 200);
  },
};
