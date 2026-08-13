# KANID Kontaktformular-API

Aktueller Weg: **Cloudflare Worker** (kostenlos).  
Die Website bleibt auf IONOS Static. PHP/Deploy-Now-PHP entfällt.

Der Worker-Code liegt in `worker.js`. Den fügst du in der Cloudflare-Oberfläche ein.

## Worker anlegen

1. Kostenloses Konto: [dash.cloudflare.com](https://dash.cloudflare.com/sign-up)
2. Links **Workers & Pages** (manchmal unter **Compute**)
3. **Create** → **Create Worker**
4. Name: `kanid-kontakt`
5. Template **Hello World** ist egal, danach **Edit code**
6. Alles löschen, Inhalt von `worker.js` aus diesem Repo einfügen, **Deploy**

Die URL sieht so aus:

`https://kanid-kontakt.<dein-subdomain>.workers.dev`

Zuerst im Browser öffnen. Es muss JSON kommen: `"ok": true`, `"runtime": "cloudflare-worker"`.

## Mail einrichten (Resend, Free)

Der Worker kann selbst nicht SMTP. Versand geht über [resend.com](https://resend.com/signup) (Free reicht).

1. Account anlegen, Domain `kanid.de` verifizieren (DNS-Einträge bei IONOS).
2. API-Key kopieren.
3. Im Worker: **Settings → Variables and Secrets → Add**
   - Name: `RESEND_API_KEY`
   - Typ: Secret
   - Wert: der Key
4. Speichern. Der Worker muss danach einmal neu deployt werden, falls Cloudflare das verlangt.

Zum Testen ohne Domain-Verifizierung akzeptiert Resend nur deren Test-Absender — für den Live-Betrieb die Domain verifizieren, sonst kommt die Mail nicht von `info@kanid.de`.

## Website verdrahten

In `KANID-Website-v4` / `config/formular.json`:

```json
{
  "endpoint": "https://kanid-kontakt.XXXX.workers.dev/"
}
```

Dann dort committen. Das Formular postet dorthin.

## Erlaubte Origins

- `https://kanid.de`
- `https://www.kanid.de`
- `https://*.app-ionos.space` (Website-Staging)
