// Netlify-Serverless-Funktion für das Kontaktformular mit Resend
const { Resend } = require('resend');

// Handler für Netlify-Funktionen
exports.handler = async function(event, context) {
  // Nur POST-Anfragen zulassen
  if (event.httpMethod !== 'POST') {
    return {
      statusCode: 405,
      body: JSON.stringify({ 
        error: 'Methode nicht erlaubt',
        message: 'Diese API unterstützt nur POST-Anfragen'
      })
    };
  }

  // CORS-Header für Cross-Origin-Anfragen
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };

  // OPTIONS-Anfragen für CORS präflights direkt beantworten
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers,
      body: ''
    };
  }

  try {
    // Anfragedaten als JSON parsen
    const formData = JSON.parse(event.body);
    const name = formData.name;
    const email = formData.email;
    const subject = formData.subject || `Kontaktanfrage von ${name}`;
    const message = formData.message;
    
    // Validierung der Eingabefelder
    if (!name || !email || !message) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Fehlende Daten',
          message: 'Bitte füllen Sie alle Pflichtfelder aus (Name, E-Mail, Nachricht)'
        })
      };
    }

    // E-Mail-Format validieren (einfache Überprüfung)
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return {
        statusCode: 400,
        headers,
        body: JSON.stringify({ 
          error: 'Ungültige E-Mail',
          message: 'Bitte geben Sie eine gültige E-Mail-Adresse ein'
        })
      };
    }

    // Resend API-Schlüssel aus Umgebungsvariablen laden oder festlegen
    // WICHTIG: In der Netlify-Oberfläche als Umgebungsvariable einstellen!
    const resendApiKey = process.env.RESEND_API_KEY || 're_VVSm8zv9_4p3YKK891J9LwDdjCBuQFGYc';
    const resend = new Resend(resendApiKey);
    
    // E-Mail-Inhalt formatieren
    const htmlContent = `
      <h2>Neue Kontaktanfrage über das Formular</h2>
      <p><strong>Name:</strong> ${name}</p>
      <p><strong>E-Mail:</strong> ${email}</p>
      <p><strong>Betreff:</strong> ${subject}</p>
      <p><strong>Nachricht:</strong></p>
      <p>${message.replace(/\n/g, '<br>')}</p>
      <hr>
      <p><small>Diese Nachricht wurde über das Kontaktformular auf kanid.de gesendet.</small></p>
    `;
    
    // E-Mail senden
    const data = await resend.emails.send({
      from: 'kontaktformular@kanid.de', // Diese Domain muss bei Resend verifiziert sein
      to: 'info@kanid.de',              // Empfänger-E-Mail
      reply_to: email,                  // Antworten gehen an den Absender
      subject: subject,
      html: htmlContent
    });
    
    // Erfolgreiche Antwort zurückgeben
    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ 
        success: true, 
        message: 'Ihre Nachricht wurde erfolgreich gesendet',
        id: data.id
      })
    };
    
  } catch (error) {
    console.error('Fehler beim Senden der E-Mail:', error);
    
    // Fehlermeldung zurückgeben
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ 
        error: 'Serverfehler',
        message: 'Beim Senden Ihrer Nachricht ist ein Fehler aufgetreten. Bitte versuchen Sie es später erneut.'
      })
    };
  }
};