const path = require('path');
const express = require('express');
const http = require('http');
const WebSocket = require('ws');

const app = express();
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '35mb' }));

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const rooms = new Map();

function getRoom(code) {
  if (!rooms.has(code)) {
    rooms.set(code, {
      code,
      clients: new Map(),
      state: null,
      hostId: null,
      updatedAt: Date.now()
    });
  }
  return rooms.get(code);
}

function broadcast(room, message, exceptId = null) {
  const data = JSON.stringify(message);
  for (const [clientId, ws] of room.clients.entries()) {
    if (clientId === exceptId) continue;
    if (ws.readyState === WebSocket.OPEN) ws.send(data);
  }
}

function cleanupRooms() {
  const now = Date.now();
  for (const [code, room] of rooms.entries()) {
    if (room.clients.size === 0 && now - room.updatedAt > 1000 * 60 * 30) {
      rooms.delete(code);
    }
  }
}

setInterval(cleanupRooms, 1000 * 60 * 5);

wss.on('connection', (ws) => {
  let room = null;
  let clientId = null;

  ws.on('message', (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return;
    }

    if (msg.type === 'join') {
      const { code, id, asHost } = msg;
      room = getRoom(code);
      clientId = id;
      room.clients.set(id, ws);
      room.updatedAt = Date.now();
      if (asHost || !room.hostId) room.hostId = id;

      ws.send(JSON.stringify({
        type: 'joined',
        code: room.code,
        hostId: room.hostId,
        state: room.state
      }));

      broadcast(room, { type: 'presence', id, joined: true }, id);
      return;
    }

    if (!room) return;

    if (msg.type === 'state') {
      if (room.hostId !== clientId) return;
      room.state = msg.state;
      room.updatedAt = Date.now();
      broadcast(room, { type: 'state', state: msg.state }, clientId);
      return;
    }

    if (msg.type === 'ping') {
      ws.send(JSON.stringify({ type: 'pong', t: Date.now() }));
      return;
    }
  });

  ws.on('close', () => {
    if (room && clientId) {
      room.clients.delete(clientId);
      room.updatedAt = Date.now();
      if (room.hostId === clientId) {
        // promote first remaining client to host
        const next = room.clients.keys().next().value || null;
        room.hostId = next;
        if (next) broadcast(room, { type: 'host', hostId: next });
      }
      broadcast(room, { type: 'presence', id: clientId, joined: false }, clientId);
    }
  });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`Server running at http://localhost:${PORT}`);
});

app.post('/api/ai-feedback', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || 'gpt-4.1';

  if (!apiKey) {
    return res.status(400).json({ error: 'OPENAI_API_KEY fehlt.' });
  }

  const { transcript, scores, metrics, videoFrames } = req.body || {};
  if (
    (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) &&
    (!Array.isArray(videoFrames) || videoFrames.length === 0)
  ) {
    return res.status(400).json({ error: 'Es braucht mindestens Transkript oder Video-Keyframes.' });
  }

  const promptText = `
Du bist ein deutschsprachiger Rhetorik-Coach.
Bewerte eine Eroeffnungsrede lernfoerderlich und konstruktiv.
Fokus ist der gehaltene Auftritt (Sprechweise, Koerpersprache, Wirkung), nicht die inhaltliche Wahrheit.
Gib konkrete, umsetzbare Tipps.

Kriterienraster (vereinfacht):
- Inhalt: Korrektheit der Behauptungen, Schlüssigkeit, Strategie, Problembewusstsein, Breite, Publikumsgerechtigkeit.
- Form (Text): Aufbau, Stilistik, Sprachlogik, Umfang (2–3 Minuten), sprachliche Korrektheit.
- Form (Auftritt): Freie Rede, Rollengerechtigkeit, Blickkontakt, Mimik, Gestik, Intonation, Tempo, Lautstärke, Artikulation, Redefluss.

Messwerte:
${JSON.stringify(metrics || {}, null, 2)}

Optionale Zusatzwerte:
${JSON.stringify(scores || {}, null, 2)}

Transkript (optional, kann leer sein):
${transcript || '(nicht vorhanden)'}

Antworte als JSON mit:
{
  "summary": "2-3 Saetze",
  "rhetorical_feedback": ["mind. 4 konkrete Beobachtungen zum Auftritt"],
  "content_feedback": ["mind. 4 konkrete Beobachtungen zu Argumentstruktur und inhaltlicher Klarheit"],
  "strengths": ["..."],
  "improvements": ["..."],
  "tips": ["..."],
  "next_steps": ["..."]
}
`.trim();

  try {
    const content = [
      { type: 'input_text', text: promptText }
    ];

    if (Array.isArray(videoFrames)) {
      const selectedFrames = videoFrames.slice(0, 6);
      selectedFrames.forEach((frame, idx) => {
        if (frame && typeof frame.dataUrl === 'string' && frame.dataUrl.startsWith('data:image/')) {
          content.push({
            type: 'input_text',
            text: `Keyframe ${idx + 1} bei ca. ${frame.timeSec || 0} Sekunden`
          });
          content.push({
            type: 'input_image',
            image_url: frame.dataUrl
          });
        }
      });
    }

    const response = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input: [
          {
            role: 'user',
            content
          }
        ],
        max_output_tokens: 600
      })
    });

    if (!response.ok) {
      const errText = await response.text();
      return res.status(500).json({ error: 'OpenAI API Fehler', details: errText });
    }

    const data = await response.json();
    const outputText =
      data.output_text ||
      (Array.isArray(data.output) && data.output[0]?.content?.[0]?.text) ||
      '';

    let parsed = null;
    try {
      parsed = JSON.parse(outputText);
    } catch {
      parsed = {
        summary: outputText,
        rhetorical_feedback: [],
        content_feedback: [],
        strengths: [],
        improvements: [],
        tips: [],
        next_steps: []
      };
    }

    return res.json({ ok: true, data: parsed });
  } catch (err) {
    return res.status(500).json({ error: 'Serverfehler', details: err.message });
  }
});

app.post('/api/transcribe-audio', async (req, res) => {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';

  if (!apiKey) {
    return res.status(400).json({ error: 'OPENAI_API_KEY fehlt.' });
  }

  const { audioBase64, language } = req.body || {};
  if (!audioBase64 || typeof audioBase64 !== 'string') {
    return res.status(400).json({ error: 'audioBase64 fehlt.' });
  }

  try {
    const buffer = Buffer.from(audioBase64, 'base64');
    const form = new FormData();
    form.append('model', model);
    form.append('language', (language && typeof language === 'string') ? language : 'de');
    form.append('file', new Blob([buffer], { type: 'audio/wav' }), 'speech.wav');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: form
    });

    if (!response.ok) {
      const details = await response.text();
      return res.status(500).json({ error: 'Transkription fehlgeschlagen.', details });
    }

    const data = await response.json();
    return res.json({ ok: true, transcript: data.text || '' });
  } catch (err) {
    return res.status(500).json({ error: 'Serverfehler', details: err.message });
  }
});
