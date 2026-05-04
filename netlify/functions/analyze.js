// netlify/functions/analyze.js
// Serverless function — runs server-side with API key secure

exports.handler = async (event) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  try {
    const { stations, mode } = JSON.parse(event.body);
    const apiKey = process.env.ANTHROPIC_API_KEY;

    if (!apiKey) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'API key not configured' }) };
    }

    let prompt;

    if (mode === 'review') {
      // Single station deep review
      const s = stations[0];
      prompt = `Cerca recensioni del distributore di carburante "${s.name}" in "${s.address || s.lat + ',' + s.lon}" Italia.
Trova: problemi con benzina/diesel (acqua, sporco, iniettori), recensioni positive/negative, pagamenti accettati.
Scrivi 4-5 frasi in italiano: reputazione basata su dati trovati, problemi specifici citati, giudizio su benzina (${s.benzina}/5) e diesel (${s.diesel}/5), consiglio finale pratico.
Sii diretto e specifico. Se non trovi nulla di specifico, di' che non ci sono segnalazioni note.`;
    } else {
      // Batch analysis
      const list = stations.map((n, i) =>
        `${i}. "${n.name}"${n.brand ? ' (' + n.brand + ')' : ''} - ${n.address || 'indirizzo non noto'} - contactless:${n.payment} - servizio:${n.attended}`
      ).join('\n');

      prompt = `Sei un esperto di qualità carburante in Italia. Analizza questi distributori cercando informazioni reali online.

DISTRIBUTORI:
${list}

Per i distributori con nomi noti, cerca recensioni specifiche. Per ognuno considera:
- Brand: ENI/Agip/Q8/IP/Shell/Esso/TotalEnergies/API = base alta (3.8-4.5 benzina)
- Distributori supermercato (Auchan/Vega/Coop/Conad/Iper) = base bassa (2.3-3.2)  
- No-brand senza segnalazioni = neutro (3.0-3.5)
- Problemi noti (acqua nel diesel, iniettori rovinati) = abbassa di 1.0-1.5
- Diesel sempre -0.2/-0.3 rispetto a benzina (rischio contaminazione)
- Self service h24 = -0.1
- Contactless accettato = +0.1
USA VARIANZA REALE — non dare lo stesso voto a tutti. Distribuisci i rating in modo realistico.

Rispondi SOLO con JSON array valido, zero testo extra:
[{"idx":0,"benzina":4.2,"diesel":3.9,"summary":"20-25 parole basate su dati reali","flag":"ok","payment_info":"accetta contactless","found_issues":false}]
flag: ok|caution|avoid`;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: mode === 'review' ? 500 : 1500,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();

    if (mode === 'review') {
      const text = data.content?.find(b => b.type === 'text')?.text || 'Recensione non disponibile.';
      const searched = data.content?.some(b => b.type === 'tool_use');
      return { statusCode: 200, headers, body: JSON.stringify({ review: text, searched }) };
    } else {
      const textBlock = data.content?.find(b => b.type === 'text');
      const txt = textBlock?.text || '[]';
      const match = txt.replace(/```json|```/g, '').match(/\[[\s\S]*\]/);
      const ratings = match ? JSON.parse(match[0]) : [];
      return { statusCode: 200, headers, body: JSON.stringify({ ratings }) };
    }

  } catch (err) {
    console.error(err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message }) };
  }
};
