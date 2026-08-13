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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/ping' || url.pathname === '/ping.php')) {
      return json({ ok: true, runtime: 'cloudflare-worker', version: 2, time: new Date().toISOString() }, 200, origin);
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
    });

    return antwort(request, { ok: true, mail: true }, 200);
  },
};
