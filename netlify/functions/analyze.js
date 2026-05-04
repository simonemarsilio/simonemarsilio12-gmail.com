exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: '{"error":"Method not allowed"}' };

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { statusCode: 500, headers, body: '{"error":"GEMINI_API_KEY not configured"}' };

  try {
    const { stations, mode } = JSON.parse(event.body);

    let prompt;

    if (mode === 'review') {
      const s = stations[0];
      prompt = `Sei un esperto di qualità carburante in Italia. Analizza il distributore "${s.name}" in "${s.address || 'Italia'}" e scrivi una recensione pratica di 4-5 frasi in italiano.

Considera: brand "${s.brand || 'no-brand'}", rating benzina ${s.benzina}/5, rating diesel ${s.diesel}/5.
Basati sulla reputazione nota del brand in Italia, rischi tipici (acqua nel diesel, serbatoi sporchi), qualità gestione.
Concludi con un consiglio diretto: fermarsi o evitare.`;

    } else {
      const list = stations.map((n, i) =>
        `${i}. "${n.name}"${n.brand ? ' (brand: ' + n.brand + ')' : ' (no-brand)'} - ${n.address || 'indirizzo non noto'} - contactless:${n.payment} - servizio:${n.attended}`
      ).join('\n');

      prompt = `Sei un esperto italiano di qualità carburante. Valuta questi distributori con rating BENZINA e DIESEL separati da 0.0 a 5.0.

DISTRIBUTORI:
${list}

CRITERI — USA VARIANZA REALE, non dare lo stesso voto a tutti:
- ENI/Agip/Q8/IP/Shell/Esso/TotalEnergies/API affidabili: 3.9-4.4 benzina
- Brand noti con gestione locale variabile: 3.5-4.0
- No-brand senza segnalazioni note: 3.0-3.5
- Distributori supermercato (Auchan, Vega, Coop, Conad, Iper, Lidl): 2.2-3.1
- Problemi noti italiani (acqua carburante, iniettori rovinati): 1.5-2.5
- Diesel sempre -0.2/-0.3 vs benzina (rischio contaminazione maggiore)
- Self service h24: -0.15
- Contactless accettato: +0.1

IMPORTANTE: distribuisci i voti in modo realistico. Varia tra i distributori.

Rispondi SOLO con un JSON array valido, nessun testo aggiuntivo, nessun markdown:
[{"idx":0,"benzina":4.1,"diesel":3.8,"summary":"20 parole massimo descrizione qualità","flag":"ok","found_issues":false}]
flag: ok|caution|avoid`;
    }

    // Call Gemini API
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`;

    const response = await fetch(geminiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: mode === 'review' ? 400 : 1200,
        }
      })
    });

    if (!response.ok) {
      const errBody = await response.text();
      console.error('Gemini error:', response.status, errBody);
      return { statusCode: 500, headers, body: JSON.stringify({ error: `Gemini error ${response.status}` }) };
    }

    const data = await response.json();
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

    if (mode === 'review') {
      return { statusCode: 200, headers, body: JSON.stringify({ review: text.trim(), searched: false }) };
    } else {
      const clean = text.replace(/```json|```/g, '').trim();
      const match = clean.match(/\[[\s\S]*\]/);
      const ratings = match ? JSON.parse(match[0]) : [];
      return { statusCode: 200, headers, body: JSON.stringify({ ratings }) };
    }

  } catch (err) {
    console.error('Function error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
