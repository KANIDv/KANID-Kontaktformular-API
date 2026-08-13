// Cloudflare Worker — in die Oberflaeche einfuegen:
// dash.cloudflare.com → Workers & Pages → Create → Hello World → Edit code
//
// Secret anlegen (Settings → Variables and Secrets):
//   RESEND_API_KEY   = re_...

const ERLAUBT = [
  'https://kanid.de',
  'https://www.kanid.de',
];

const ERLAUBT_SUFFIX = '.app-ionos.space';
const EMPFAENGER = 'info@kanid.de';
const DANKE = 'https://kanid.de/danke';

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/ping' || url.pathname === '/ping.php')) {
      return json({ ok: true, runtime: 'cloudflare-worker', time: new Date().toISOString() }, 200, origin);
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
    const email = feld(form.get('email'), 180);
    const subject = feld(form.get('subject'), 180);
    const message = typeof form.get('message') === 'string'
      ? form.get('message').replace(/\0/g, '').trim().slice(0, 5000)
      : '';

    if (!name || !email || !subject || !message) {
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

    const text = [
      'Neue Nachricht über das Kontaktformular auf kanid.de',
      '',
      `Name:    ${name}`,
      `E-Mail:  ${email}`,
      `Betreff: ${subject}`,
      '',
      'Nachricht:',
      message,
    ].join('\n');

    const resend = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'KANID Kontaktformular <info@kanid.de>',
        to: [EMPFAENGER],
        reply_to: email,
        subject: `Kontaktanfrage: ${subject}`,
        text,
      }),
    });

    if (!resend.ok) {
      return antwort(request, {
        ok: false,
        error: 'mail',
        meldung: 'Die Nachricht konnte nicht versendet werden. Bitte schreiben Sie direkt an info@kanid.de.',
      }, 500);
    }

    return antwort(request, { ok: true, mail: true }, 200);
  },
};
