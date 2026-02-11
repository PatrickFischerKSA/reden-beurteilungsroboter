const rubricData = [
  {
    id: 'inhalt',
    title: 'Inhalt Eröffnungsrede',
    weight: '8%',
    maxPoints: 2,
    criteria: [
      'Korrektheit der Behauptungen',
      'Schlüssigkeit der Argumentation',
      'Strategie',
      'Problembewusstsein (u. a. Achtung vor Grundrechten)',
      'Breite der Informationen (mit Blick auf die ergänzende Rede)',
      'Publikumsgerechtigkeit'
    ]
  },
  {
    id: 'form_text',
    title: 'Form Eröffnungsrede (Text)',
    weight: '4%',
    maxPoints: 1,
    criteria: [
      'Aufbau',
      'Rhetorische Gestaltung und Stilistik',
      'Sprachlogik',
      'Umfang (2–3 Minuten)',
      'Sprachliche Korrektheit'
    ]
  },
  {
    id: 'form_auftritt',
    title: 'Form Eröffnungsrede (Auftritt)',
    weight: '8%',
    maxPoints: 2,
    criteria: [
      'Freie Rede',
      'Rollengerechtigkeit',
      'Blickkontakt',
      'Mimik',
      'Gestik',
      'Intonation',
      'Tempo',
      'Lautstärke',
      'Artikulation',
      'Redefluss'
    ]
  }
];

const fillers = [
  'äh', 'ähm', 'hm', 'also', 'sozusagen', 'irgendwie', 'halt', 'eben', 'quasi', 'naja', 'ok', 'okay', 'tja'
];

const rubricRoot = document.getElementById('rubric');
const videoInput = document.getElementById('videoInput');
const videoPreview = document.getElementById('videoPreview');
const videoMeta = document.getElementById('videoMeta');
const cvToggle = document.getElementById('cvToggle');
const cvStatus = document.getElementById('cvStatus');
const transcript = document.getElementById('transcript');
const transcriptMeta = document.getElementById('transcriptMeta');
const analyzeBtn = document.getElementById('analyzeBtn');
const downloadBtn = document.getElementById('downloadBtn');
const aiBtn = document.getElementById('aiBtn');
const aiStatus = document.getElementById('aiStatus');
const aiFeedback = document.getElementById('aiFeedback');

const totalScoreEl = document.getElementById('totalScore');
const timeScoreEl = document.getElementById('timeScore');
const tempoScoreEl = document.getElementById('tempoScore');
const pauseScoreEl = document.getElementById('pauseScore');
const eyeScoreEl = document.getElementById('eyeScore');
const gestureScoreEl = document.getElementById('gestureScore');
const faceScoreEl = document.getElementById('faceScore');
const timeHintEl = document.getElementById('timeHint');
const feedbackEl = document.getElementById('feedback');

let lastAnalysis = null;
let audioMetrics = null;
let cvMetrics = null;

function renderRubric() {
  rubricRoot.innerHTML = '';
  rubricData.forEach((section) => {
    const wrap = document.createElement('div');
    wrap.className = 'rubric-section';

    const header = document.createElement('div');
    header.className = 'rubric-header';
    header.innerHTML = `<h3>${section.title}</h3><span>max. ${section.maxPoints} Punkte · Gewicht ${section.weight}</span>`;

    const criteriaList = document.createElement('div');
    criteriaList.className = 'criteria';

    section.criteria.forEach((criterion, index) => {
      const label = document.createElement('label');
      label.dataset.section = section.id;
      label.dataset.index = index;
      label.innerHTML = `
        <div>${criterion}</div>
        <input type="range" min="0" max="${section.maxPoints}" step="0.5" value="0" />
        <div class="value">Selbsteinschätzung: <span>0</span> / ${section.maxPoints}</div>
      `;
      const input = label.querySelector('input');
      const valueSpan = label.querySelector('span');
      input.addEventListener('input', () => {
        valueSpan.textContent = input.value;
        label.classList.toggle('active', Number(input.value) > 0);
      });

      criteriaList.appendChild(label);
    });

    wrap.appendChild(header);
    wrap.appendChild(criteriaList);
    rubricRoot.appendChild(wrap);
  });
}

function wordCount(text) {
  const words = text.trim().split(/\s+/).filter(Boolean);
  return words.length;
}

function calcWpm(words, seconds) {
  if (!seconds || !words) return 0;
  return Math.round((words / (seconds / 60)) * 10) / 10;
}

function getVideoDuration() {
  if (Number.isFinite(videoPreview.duration)) return videoPreview.duration;
  return 0;
}

function updateTranscriptMeta() {
  const words = wordCount(transcript.value);
  const duration = getVideoDuration();
  const wpm = calcWpm(words, duration);
  transcriptMeta.textContent = `Wörter: ${words} · Tempo: ${wpm ? wpm + ' W/Min' : '–'}`;
}

function formatTime(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return '–';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

async function analyzeAudio(file) {
  if (!file) return null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const channel = audioBuffer.getChannelData(0);
    let sum = 0;
    let silent = 0;
    const threshold = 0.02;
    for (let i = 0; i < channel.length; i += 2048) {
      const sample = channel[i];
      sum += Math.abs(sample);
      if (Math.abs(sample) < threshold) silent += 1;
    }
    const avg = sum / (channel.length / 2048);
    const silentRatio = silent / (channel.length / 2048);
    audioContext.close();
    return {
      avgVolume: avg,
      silentRatio
    };
  } catch (err) {
    return null;
  }
}

function seekTo(time) {
  return new Promise((resolve) => {
    const handler = () => {
      videoPreview.removeEventListener('seeked', handler);
      resolve();
    };
    videoPreview.addEventListener('seeked', handler);
    const safeTime = Math.max(0, Math.min(time, (videoPreview.duration || 0) - 0.01));
    videoPreview.currentTime = safeTime;
  });
}

async function analyzeVideoCV() {
  if (!cvToggle.checked) return null;
  if (!getVideoDuration()) return null;
  if (typeof FaceDetection === 'undefined' || typeof Pose === 'undefined') return null;

  const faceDetection = new FaceDetection({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`
  });
  faceDetection.setOptions({
    model: 'short',
    minDetectionConfidence: 0.5
  });
  let faceResult = null;
  faceDetection.onResults((res) => {
    faceResult = res;
  });

  const pose = new Pose({
    locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
  });
  pose.setOptions({
    modelComplexity: 0,
    smoothLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  let poseResult = null;
  pose.onResults((res) => {
    poseResult = res;
  });

  const duration = getVideoDuration();
  const maxFrames = 120;
  const sampleCount = Math.min(maxFrames, Math.max(20, Math.ceil(duration / 0.6)));
  const interval = duration / sampleCount;

  let frames = 0;
  let faceDetected = 0;
  let eyeContact = 0;
  let movementSum = 0;
  let movementFrames = 0;
  let prevWrist = null;

  const originalTime = videoPreview.currentTime;
  const wasPaused = videoPreview.paused;
  videoPreview.pause();

  for (let i = 0; i <= sampleCount; i += 1) {
    const t = Math.min(duration - 0.02, i * interval);
    await seekTo(t);
    await faceDetection.send({ image: videoPreview });
    await pose.send({ image: videoPreview });

    frames += 1;

    if (faceResult?.detections?.length) {
      faceDetected += 1;
      const box = faceResult.detections[0].boundingBox || {};
      const cxRaw = box.xCenter ?? (box.xmin + (box.width || 0) / 2);
      const cyRaw = box.yCenter ?? (box.ymin + (box.height || 0) / 2);
      const w = videoPreview.videoWidth || 1;
      const h = videoPreview.videoHeight || 1;
      const cx = cxRaw > 1 ? cxRaw / w : cxRaw;
      const cy = cyRaw > 1 ? cyRaw / h : cyRaw;
      if (Math.abs(cx - 0.5) < 0.15 && Math.abs(cy - 0.5) < 0.2) {
        eyeContact += 1;
      }
    }

    if (poseResult?.poseLandmarks?.length) {
      const left = poseResult.poseLandmarks[15];
      const right = poseResult.poseLandmarks[16];
      if (left && right) {
        const wrist = { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
        if (prevWrist) {
          const dx = wrist.x - prevWrist.x;
          const dy = wrist.y - prevWrist.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          movementSum += dist;
          movementFrames += 1;
        }
        prevWrist = wrist;
      }
    }
  }

  await seekTo(originalTime);
  if (!wasPaused) {
    videoPreview.play().catch(() => {});
  }

  faceDetection.close && faceDetection.close();
  pose.close && pose.close();

  const facePresence = frames ? faceDetected / frames : 0;
  const eyeContactRatio = faceDetected ? eyeContact / faceDetected : 0;
  const gestureEnergy = movementFrames ? movementSum / movementFrames : 0;

  return {
    facePresence,
    eyeContactRatio,
    gestureEnergy,
    frames
  };
}

function collectScores() {
  const sections = {};
  rubricData.forEach((section) => {
    const inputs = Array.from(document.querySelectorAll(`[data-section="${section.id}"] input`));
    const values = inputs.map((input) => Number(input.value));
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    sections[section.id] = {
      avg,
      max: section.maxPoints,
      title: section.title
    };
  });
  return sections;
}

function fillerCount(text) {
  const lower = text.toLowerCase();
  return fillers.reduce((total, filler) => {
    const regex = new RegExp(`\\b${filler}\\b`, 'g');
    const matches = lower.match(regex);
    return total + (matches ? matches.length : 0);
  }, 0);
}

function buildFeedback({ duration, words, wpm, fillerTotal, scores, audio, cv }) {
  const feedback = [];
  if (!duration) {
    feedback.push('Füge ein Video hinzu, damit Dauer und Tempo gemessen werden können.');
  } else if (duration < 120) {
    feedback.push('Deine Rede ist unter 2 Minuten. Ergänze ein kurzes Strategie‑ oder Problem‑Argument, um den Umfang zu erweitern.');
  } else if (duration > 180) {
    feedback.push('Deine Rede ist länger als 3 Minuten. Kürze Nebenargumente oder bündle Beispiele.');
  } else {
    feedback.push('Die Dauer liegt im Zielbereich (2–3 Minuten).');
  }

  if (wpm) {
    if (wpm < 110) feedback.push('Du sprichst eher langsam. Erhöhe die Spannung mit klaren Übergängen und etwas mehr Tempo.');
    if (wpm > 150) feedback.push('Das Tempo ist hoch. Baue bewusst kurze Pausen für Schlüsselargumente ein.');
    if (wpm >= 110 && wpm <= 150) feedback.push('Dein Sprechtempo liegt im idealen Bereich.');
  }

  if (words) {
    if (fillerTotal > 6) feedback.push('Viele Füllwörter erkannt. Übe bewusste Pausen statt „äh/also“.');
    if (fillerTotal <= 6) feedback.push('Die Anzahl an Füllwörtern ist gering – gut für die Klarheit.');
  }

  if (audio?.silentRatio) {
    if (audio.silentRatio < 0.15) feedback.push('Du machst wenige Pausen. Setze nach wichtigen Aussagen eine kurze Pause.');
    if (audio.silentRatio > 0.35) feedback.push('Viele Pausen erkannt. Achte darauf, den Redefluss stabil zu halten.');
  }

  if (cv?.facePresence !== undefined) {
    if (cv.facePresence < 0.6) feedback.push('Dein Gesicht wird nur selten erkannt. Achte auf gute Beleuchtung und eine zentrale Kameraposition.');
    if (cv.eyeContactRatio < 0.55) feedback.push('Der Blickkontakt wirkt wechselhaft. Richte den Blick häufiger zur Kamera.');
    if (cv.gestureEnergy < 0.01) feedback.push('Sehr wenig Gestik erkannt. Ergänze Handbewegungen zur Strukturierung deiner Argumente.');
    if (cv.gestureEnergy > 0.05) feedback.push('Sehr viel Gestik erkannt. Achte darauf, Bewegungen gezielt einzusetzen.');
  }

  Object.values(scores).forEach((section) => {
    if (section.avg <= section.max * 0.6) {
      feedback.push(`Im Bereich „${section.title}“ gibt es Potenzial. Suche dir 1–2 Kriterien und übe sie gezielt.`);
    }
  });

  feedback.push('Nutze das Raster als Lernfahrplan: Notiere zu jedem niedrigen Kriterium eine konkrete Übung (z. B. Blickkontakt, Gestik, Präzision der Argumente).');

  return feedback;
}

function updateScoreboard({ duration, wpm, audio, cv }) {
  timeScoreEl.textContent = duration ? formatTime(duration) : '–';
  tempoScoreEl.textContent = wpm ? `${wpm} W/Min` : '–';
  if (audio?.silentRatio !== undefined) {
    pauseScoreEl.textContent = `${Math.round(audio.silentRatio * 100)}%`; 
  } else {
    pauseScoreEl.textContent = '–';
  }

  if (cv?.eyeContactRatio !== undefined) {
    eyeScoreEl.textContent = `${Math.round(cv.eyeContactRatio * 100)}%`;
    gestureScoreEl.textContent = cv.gestureEnergy.toFixed(3);
    faceScoreEl.textContent = `${Math.round(cv.facePresence * 100)}%`;
  } else {
    eyeScoreEl.textContent = '–';
    gestureScoreEl.textContent = '–';
    faceScoreEl.textContent = '–';
  }

  if (duration) {
    if (duration < 120) timeHintEl.textContent = 'Unter 2 Minuten – erweitere Inhalt oder Beispiele.';
    else if (duration > 180) timeHintEl.textContent = 'Über 3 Minuten – straffe Nebenpunkte.';
    else timeHintEl.textContent = 'Zielbereich getroffen.';
  }
}

function scoreSummary(scores) {
  const total = Object.values(scores).reduce((sum, section) => sum + section.avg, 0);
  return Math.round(total * 10) / 10;
}

function buildReport(data) {
  const lines = [];
  lines.push('# Reden‑Beurteilungsroboter – Bericht');
  lines.push('');
  lines.push(`Datum: ${new Date().toLocaleString('de-CH')}`);
  lines.push('');
  lines.push('## Messwerte');
  lines.push(`- Dauer: ${data.duration ? formatTime(data.duration) : '–'}`);
  lines.push(`- Wörter: ${data.words}`);
  lines.push(`- Tempo: ${data.wpm ? data.wpm + ' W/Min' : '–'}`);
  if (data.audio?.silentRatio !== undefined) {
    lines.push(`- Pausenanteil: ${Math.round(data.audio.silentRatio * 100)}%`);
  }
  if (data.cvMetrics?.eyeContactRatio !== undefined) {
    lines.push(`- Blickkontakt (Proxy): ${Math.round(data.cvMetrics.eyeContactRatio * 100)}%`);
    lines.push(`- Gestik (Bewegung): ${data.cvMetrics.gestureEnergy.toFixed(3)}`);
    lines.push(`- Gesicht erkannt: ${Math.round(data.cvMetrics.facePresence * 100)}%`);
  }
  lines.push('');
  lines.push('## Selbsteinschätzung');
  Object.values(data.scores).forEach((section) => {
    lines.push(`- ${section.title}: ${section.avg.toFixed(1)} / ${section.max}`);
  });
  lines.push('');
  lines.push('## Feedback');
  data.feedback.forEach((tip) => lines.push(`- ${tip}`));
  return lines.join('\n');
}

renderRubric();

videoInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  const url = URL.createObjectURL(file);
  videoPreview.src = url;
  videoPreview.load();

  videoPreview.onloadedmetadata = () => {
    const duration = videoPreview.duration;
    videoMeta.textContent = `Datei: ${file.name} · Dauer: ${formatTime(duration)}`;
    updateTranscriptMeta();
  };

  audioMetrics = await analyzeAudio(file);
});

transcript.addEventListener('input', updateTranscriptMeta);

analyzeBtn.addEventListener('click', async () => {
  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyse läuft...';
  cvStatus.textContent = cvToggle.checked ? 'Videoanalyse läuft...' : 'Videoanalyse aus.';

  if (cvToggle.checked) {
    cvMetrics = await analyzeVideoCV();
    if (cvMetrics) {
      cvStatus.textContent = 'Videoanalyse abgeschlossen.';
    } else {
      cvStatus.textContent = 'Videoanalyse nicht verfügbar (fehlende Unterstützung oder kein Video).';
    }
  } else {
    cvMetrics = null;
  }

  const duration = getVideoDuration();
  const words = wordCount(transcript.value);
  const wpm = calcWpm(words, duration);
  const fillerTotal = fillerCount(transcript.value);
  const scores = collectScores();
  const feedback = buildFeedback({ duration, words, wpm, fillerTotal, scores, audio: audioMetrics, cv: cvMetrics });
  const totalScore = scoreSummary(scores);

  totalScoreEl.textContent = totalScore.toFixed(1);
  updateScoreboard({ duration, wpm, audio: audioMetrics, cv: cvMetrics });

  feedbackEl.innerHTML = '<ul>' + feedback.map((tip) => `<li>${tip}</li>`).join('') + '</ul>';

  lastAnalysis = {
    duration,
    words,
    wpm,
    fillerTotal,
    scores,
    feedback,
    audio: audioMetrics,
    cvMetrics
  };

  analyzeBtn.disabled = false;
  analyzeBtn.textContent = 'Analyse starten';
});

downloadBtn.addEventListener('click', () => {
  if (!lastAnalysis) {
    feedbackEl.innerHTML = '<p>Bitte zuerst analysieren.</p>';
    return;
  }
  const report = buildReport(lastAnalysis);
  const blob = new Blob([report], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'reden-beurteilung-bericht.md';
  a.click();
  URL.revokeObjectURL(url);
});

function renderAiFeedback(data) {
  aiFeedback.innerHTML = '';
  if (!data) return;
  const container = document.createElement('div');

  if (data.summary) {
    const p = document.createElement('p');
    p.textContent = data.summary;
    container.appendChild(p);
  }

  const lists = [
    { title: 'Stärken', key: 'strengths' },
    { title: 'Verbesserungen', key: 'improvements' },
    { title: 'Tipps', key: 'tips' },
    { title: 'Nächste Schritte', key: 'next_steps' }
  ];

  lists.forEach((item) => {
    if (Array.isArray(data[item.key]) && data[item.key].length) {
      const h = document.createElement('h3');
      h.textContent = item.title;
      const ul = document.createElement('ul');
      data[item.key].forEach((entry) => {
        const li = document.createElement('li');
        li.textContent = entry;
        ul.appendChild(li);
      });
      container.appendChild(h);
      container.appendChild(ul);
    }
  });

  aiFeedback.appendChild(container);
}

aiBtn.addEventListener('click', async () => {
  if (!lastAnalysis) {
    aiStatus.textContent = 'Bitte zuerst die lokale Analyse ausführen.';
    return;
  }

  aiBtn.disabled = true;
  aiStatus.textContent = 'KI‑Analyse läuft...';
  aiFeedback.innerHTML = '';

  try {
    const response = await fetch('/api/ai-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: transcript.value,
        scores: lastAnalysis.scores,
        metrics: {
          duration: lastAnalysis.duration,
          words: lastAnalysis.words,
          wpm: lastAnalysis.wpm,
          fillerTotal: lastAnalysis.fillerTotal
        },
        cvMetrics: lastAnalysis.cvMetrics
      })
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'KI‑Analyse fehlgeschlagen.');
    }

    renderAiFeedback(payload.data);
    aiStatus.textContent = 'KI‑Feedback aktualisiert.';
  } catch (err) {
    aiStatus.textContent = `Fehler: ${err.message}`;
  } finally {
    aiBtn.disabled = false;
  }
});
