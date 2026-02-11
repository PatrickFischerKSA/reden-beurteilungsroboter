const rubricData = [
  {
    id: 'inhalt',
    title: 'Inhalt Eroeffnungsrede',
    weight: '8%',
    maxPoints: 2,
    criteria: [
      'Korrektheit der Behauptungen',
      'Schluessigkeit der Argumentation',
      'Strategie',
      'Problembewusstsein (u. a. Achtung vor Grundrechten)',
      'Breite der Informationen (mit Blick auf die ergaenzende Rede)',
      'Publikumsgerechtigkeit'
    ]
  },
  {
    id: 'form_text',
    title: 'Form Eroeffnungsrede (Text)',
    weight: '4%',
    maxPoints: 1,
    criteria: [
      'Aufbau',
      'Rhetorische Gestaltung und Stilistik',
      'Sprachlogik',
      'Umfang (2-3 Minuten)',
      'Sprachliche Korrektheit'
    ]
  },
  {
    id: 'form_auftritt',
    title: 'Form Eroeffnungsrede (Auftritt)',
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
      'Lautstaerke',
      'Artikulation',
      'Redefluss'
    ]
  }
];

const rubricRoot = document.getElementById('rubric');
const videoInput = document.getElementById('videoInput');
const videoPreview = document.getElementById('videoPreview');
const videoMeta = document.getElementById('videoMeta');
const analysisStatus = document.getElementById('analysisStatus');
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

let currentVideoFile = null;
let audioMetrics = null;
let visualMetrics = null;
let lastAnalysis = null;

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
        <div class="value">Selbsteinschaetzung: <span>0</span> / ${section.maxPoints}</div>
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
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function formatTime(seconds) {
  if (!seconds || !Number.isFinite(seconds)) return '-';
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

function getVideoDuration() {
  if (Number.isFinite(videoPreview.duration)) return videoPreview.duration;
  return 0;
}

function updateTranscriptMeta() {
  const words = wordCount(transcript.value);
  transcriptMeta.textContent = `Woerter: ${words} · optional fuer KI-Feedback`;
}

function seekTo(time) {
  return new Promise((resolve) => {
    const onSeeked = () => {
      videoPreview.removeEventListener('seeked', onSeeked);
      resolve();
    };
    videoPreview.addEventListener('seeked', onSeeked);
    const maxTime = Math.max(0, (videoPreview.duration || 0) - 0.02);
    videoPreview.currentTime = Math.max(0, Math.min(time, maxTime));
  });
}

async function analyzeAudio(file) {
  if (!file) return null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    const channel = audioBuffer.getChannelData(0);

    const step = 2048;
    let silent = 0;
    let sum = 0;
    let peak = 0;
    const energySeries = [];

    for (let i = 0; i < channel.length; i += step) {
      const sample = Math.abs(channel[i]);
      energySeries.push(sample);
      sum += sample;
      if (sample < 0.02) silent += 1;
      if (sample > peak) peak = sample;
    }

    const frames = Math.max(1, Math.floor(channel.length / step));
    const avgVolume = sum / frames;
    const silentRatio = silent / frames;
    const dynamicRange = Math.max(0, peak - avgVolume);

    audioContext.close();
    return { avgVolume, silentRatio, dynamicRange };
  } catch (_err) {
    return null;
  }
}

function tempoLabel(audio) {
  if (!audio) return '-';
  if (audio.silentRatio > 0.42) return 'eher langsam';
  if (audio.silentRatio < 0.18) return 'eher schnell';
  return 'ausgeglichen';
}

async function analyzeVideoFrames(onProgress) {
  const duration = getVideoDuration();
  if (!duration) return null;

  const width = 192;
  const height = 108;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const detector = ('FaceDetector' in window)
    ? new FaceDetector({ fastMode: true, maxDetectedFaces: 1 })
    : null;

  const sampleCount = Math.min(64, Math.max(24, Math.ceil(duration / 2)));
  const interval = duration / sampleCount;
  const keyframeSteps = new Set([0, Math.floor(sampleCount * 0.2), Math.floor(sampleCount * 0.4), Math.floor(sampleCount * 0.6), Math.floor(sampleCount * 0.8), sampleCount - 1]);

  const keyframes = [];
  let previous = null;
  let motionSum = 0;
  let motionFrames = 0;
  let faceDetected = 0;
  let eyeCentered = 0;

  const originalTime = videoPreview.currentTime;
  const wasPaused = videoPreview.paused;
  videoPreview.pause();

  for (let i = 0; i < sampleCount; i += 1) {
    const t = Math.min(duration - 0.02, i * interval);
    await seekTo(t);
    ctx.drawImage(videoPreview, 0, 0, width, height);

    const img = ctx.getImageData(0, 0, width, height).data;
    if (previous) {
      let diff = 0;
      for (let p = 0; p < img.length; p += 16) {
        diff += Math.abs(img[p] - previous[p]);
      }
      motionSum += diff / (img.length / 16) / 255;
      motionFrames += 1;
    }
    previous = img;

    if (detector) {
      try {
        const faces = await detector.detect(canvas);
        if (faces.length) {
          faceDetected += 1;
          const box = faces[0].boundingBox;
          const cx = (box.x + box.width / 2) / width;
          const cy = (box.y + box.height / 2) / height;
          if (Math.abs(cx - 0.5) < 0.18 && Math.abs(cy - 0.45) < 0.2) {
            eyeCentered += 1;
          }
        }
      } catch (_err) {
        // FaceDetector can fail depending on browser/runtime; analysis continues.
      }
    }

    if (keyframeSteps.has(i)) {
      keyframes.push({
        timeSec: Math.round(t),
        dataUrl: canvas.toDataURL('image/jpeg', 0.58)
      });
    }

    if (onProgress) onProgress(i + 1, sampleCount);
  }

  await seekTo(originalTime);
  if (!wasPaused) videoPreview.play().catch(() => {});

  const facePresence = detector ? faceDetected / sampleCount : null;
  const eyeContactRatio = detector && faceDetected ? eyeCentered / faceDetected : null;
  const motionEnergy = motionFrames ? motionSum / motionFrames : 0;

  return {
    motionEnergy,
    facePresence,
    eyeContactRatio,
    keyframes,
    sampleCount,
    detectorAvailable: Boolean(detector)
  };
}

function collectScores() {
  const sections = {};
  let hasInput = false;

  rubricData.forEach((section) => {
    const inputs = Array.from(document.querySelectorAll(`[data-section="${section.id}"] input`));
    const values = inputs.map((input) => Number(input.value));
    if (values.some((v) => v > 0)) hasInput = true;
    const avg = values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;

    sections[section.id] = {
      avg,
      max: section.maxPoints,
      title: section.title
    };
  });

  return { sections, hasInput };
}

function videoScore({ duration, audio, visual }) {
  let score = 0;
  let max = 0;

  max += 1.5;
  if (duration >= 120 && duration <= 180) score += 1.5;
  else if (duration >= 90 && duration <= 210) score += 0.8;

  max += 1.2;
  if (audio) {
    if (audio.silentRatio >= 0.18 && audio.silentRatio <= 0.38) score += 1.2;
    else score += 0.6;
  }

  max += 1.2;
  if (visual) {
    if (visual.motionEnergy >= 0.01 && visual.motionEnergy <= 0.055) score += 1.2;
    else if (visual.motionEnergy > 0.004) score += 0.7;
  }

  if (visual && visual.detectorAvailable && visual.facePresence !== null) {
    max += 1.1;
    if (visual.facePresence >= 0.6) score += 1.1;
    else if (visual.facePresence >= 0.4) score += 0.6;

    max += 1.0;
    if (visual.eyeContactRatio >= 0.55) score += 1.0;
    else if (visual.eyeContactRatio >= 0.35) score += 0.5;
  }

  if (!max) return 0;
  return (score / max) * 5;
}

function buildFeedback({ duration, audio, visual, rubric }) {
  const feedback = [];

  if (!duration) {
    feedback.push('Kein Video erkannt. Bitte zuerst ein Video hochladen.');
    return feedback;
  }

  if (duration < 120) feedback.push('Rede ist zu kurz fuer das Ziel (2-3 Minuten). Erweitere einen Hauptpunkt mit Beispiel und Gegenargument.');
  if (duration > 180) feedback.push('Rede ist zu lang fuer das Ziel (2-3 Minuten). Straffe Einleitung und Nebengedanken.');
  if (duration >= 120 && duration <= 180) feedback.push('Zeitfenster 2-3 Minuten ist erreicht.');

  if (audio) {
    if (audio.silentRatio < 0.18) feedback.push('Wenig Pausen erkennbar. Setze nach Kernaussagen kurze Sprechpausen.');
    if (audio.silentRatio > 0.38) feedback.push('Viele laengere Pausen erkennbar. Verbinde Argumente mit klaren Uebergaengen.');
    if (audio.dynamicRange < 0.08) feedback.push('Stimmliche Dynamik wirkt eher flach. Arbeite mit gezielter Betonung.');
  } else {
    feedback.push('Audio konnte nicht ausgewertet werden. Pruefe, ob das Video eine Tonspur enthaelt.');
  }

  if (visual) {
    if (visual.motionEnergy < 0.01) feedback.push('Sehr wenig koerperliche Bewegung. Nutze Gestik zur Strukturierung deiner Argumente.');
    if (visual.motionEnergy > 0.06) feedback.push('Sehr hohe Bewegungsenergie. Reduziere unruhige Bewegungen und halte den Stand stabil.');

    if (visual.detectorAvailable) {
      if (visual.facePresence !== null && visual.facePresence < 0.55) {
        feedback.push('Gesicht oft nicht klar im Bild. Kamerahoehe und Bildausschnitt verbessern.');
      }
      if (visual.eyeContactRatio !== null && visual.eyeContactRatio < 0.5) {
        feedback.push('Blickkontakt zur Kamera ist ausbaufahig. Blick haeufiger zum Objektiv richten.');
      }
    } else {
      feedback.push('Browser bietet keine Face-Detection. Blickkontakt-Metrik ist deshalb nicht verfuegbar.');
    }
  }

  if (rubric.hasInput) {
    Object.values(rubric.sections).forEach((section) => {
      if (section.avg <= section.max * 0.6) {
        feedback.push(`Im Bereich "${section.title}" ist Potenzial vorhanden. Uebe 1-2 Kriterien gezielt.`);
      }
    });
  }

  feedback.push('Naechster Lernschritt: exakt eine Stellschraube auswaehlen und die Rede danach erneut aufnehmen.');
  return feedback;
}

function updateScoreboard({ duration, audio, visual }) {
  timeScoreEl.textContent = duration ? formatTime(duration) : '-';
  tempoScoreEl.textContent = tempoLabel(audio);
  pauseScoreEl.textContent = audio ? `${Math.round(audio.silentRatio * 100)}%` : '-';

  if (visual && visual.motionEnergy !== undefined) {
    gestureScoreEl.textContent = visual.motionEnergy.toFixed(3);
  } else {
    gestureScoreEl.textContent = '-';
  }

  if (visual && visual.facePresence !== null && visual.facePresence !== undefined) {
    faceScoreEl.textContent = `${Math.round(visual.facePresence * 100)}%`;
  } else {
    faceScoreEl.textContent = '-';
  }

  if (visual && visual.eyeContactRatio !== null && visual.eyeContactRatio !== undefined) {
    eyeScoreEl.textContent = `${Math.round(visual.eyeContactRatio * 100)}%`;
  } else {
    eyeScoreEl.textContent = '-';
  }

  if (duration) {
    if (duration < 120) timeHintEl.textContent = 'Unter 2 Minuten.';
    else if (duration > 180) timeHintEl.textContent = 'Ueber 3 Minuten.';
    else timeHintEl.textContent = 'Zielbereich erreicht.';
  }
}

function buildReport(data) {
  const lines = [];
  lines.push('# Reden-Beurteilungsroboter - Bericht');
  lines.push('');
  lines.push(`Datum: ${new Date().toLocaleString('de-CH')}`);
  lines.push('');
  lines.push('## Videoanalyse');
  lines.push(`- Dauer: ${data.duration ? formatTime(data.duration) : '-'}`);
  lines.push(`- Sprechtempo (Proxy): ${tempoLabel(data.audio)}`);
  lines.push(`- Pausenanteil: ${data.audio ? Math.round(data.audio.silentRatio * 100) + '%' : '-'}`);
  lines.push(`- Bewegungsenergie: ${data.visual ? data.visual.motionEnergy.toFixed(3) : '-'}`);
  lines.push(`- Gesicht im Bild: ${data.visual && data.visual.facePresence !== null ? Math.round(data.visual.facePresence * 100) + '%' : '-'}`);
  lines.push(`- Blickkontakt (Proxy): ${data.visual && data.visual.eyeContactRatio !== null ? Math.round(data.visual.eyeContactRatio * 100) + '%' : '-'}`);
  lines.push('');
  lines.push('## Selbsteinschaetzung');
  Object.values(data.rubric.sections).forEach((section) => {
    lines.push(`- ${section.title}: ${section.avg.toFixed(1)} / ${section.max}`);
  });
  lines.push('');
  lines.push('## Feedback');
  data.feedback.forEach((tip) => lines.push(`- ${tip}`));
  return lines.join('\n');
}

function renderAiFeedback(data) {
  aiFeedback.innerHTML = '';
  if (!data) return;
  const container = document.createElement('div');

  if (data.summary) {
    const p = document.createElement('p');
    p.textContent = data.summary;
    container.appendChild(p);
  }

  const blocks = [
    { title: 'Staerken', key: 'strengths' },
    { title: 'Verbesserungen', key: 'improvements' },
    { title: 'Tipps', key: 'tips' },
    { title: 'Naechste Schritte', key: 'next_steps' }
  ];

  blocks.forEach((block) => {
    if (Array.isArray(data[block.key]) && data[block.key].length) {
      const h = document.createElement('h3');
      h.textContent = block.title;
      const ul = document.createElement('ul');
      data[block.key].forEach((entry) => {
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

async function runLocalAnalysis() {
  if (!currentVideoFile || !getVideoDuration()) {
    analysisStatus.textContent = 'Bitte zuerst ein Video laden.';
    return;
  }

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyse laeuft...';
  analysisStatus.textContent = 'Audioanalyse laeuft...';

  audioMetrics = await analyzeAudio(currentVideoFile);

  analysisStatus.textContent = 'Video wird ausgewertet...';
  visualMetrics = await analyzeVideoFrames((step, total) => {
    analysisStatus.textContent = `Videoanalyse: ${step}/${total} Frames`;
  });

  const duration = getVideoDuration();
  const rubric = collectScores();
  const autoScore = videoScore({ duration, audio: audioMetrics, visual: visualMetrics });
  const rubricScore = Object.values(rubric.sections).reduce((sum, section) => sum + section.avg, 0);
  const totalScore = rubric.hasInput ? (autoScore + rubricScore) / 2 : autoScore;

  const feedback = buildFeedback({
    duration,
    audio: audioMetrics,
    visual: visualMetrics,
    rubric
  });

  totalScoreEl.textContent = totalScore.toFixed(1);
  updateScoreboard({ duration, audio: audioMetrics, visual: visualMetrics });
  feedbackEl.innerHTML = `<ul>${feedback.map((tip) => `<li>${tip}</li>`).join('')}</ul>`;
  analysisStatus.textContent = 'Analyse abgeschlossen.';

  lastAnalysis = {
    duration,
    audio: audioMetrics,
    visual: visualMetrics,
    rubric,
    feedback,
    score: totalScore,
    transcript: transcript.value.trim()
  };

  analyzeBtn.disabled = false;
  analyzeBtn.textContent = 'Video erneut analysieren';
}

renderRubric();
updateTranscriptMeta();

videoInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  currentVideoFile = file;
  const url = URL.createObjectURL(file);
  videoPreview.src = url;
  videoPreview.load();

  videoPreview.onloadedmetadata = async () => {
    videoMeta.textContent = `Datei: ${file.name} · Dauer: ${formatTime(videoPreview.duration)}`;
    analysisStatus.textContent = 'Video geladen. Starte automatische Analyse...';
    await runLocalAnalysis();
  };
});

transcript.addEventListener('input', updateTranscriptMeta);
analyzeBtn.addEventListener('click', runLocalAnalysis);

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

aiBtn.addEventListener('click', async () => {
  if (!lastAnalysis) {
    aiStatus.textContent = 'Bitte zuerst lokale Videoanalyse ausfuehren.';
    return;
  }

  aiBtn.disabled = true;
  aiStatus.textContent = 'KI-Feedback laeuft...';
  aiFeedback.innerHTML = '';

  try {
    const response = await fetch('/api/ai-feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        transcript: transcript.value.trim(),
        metrics: {
          duration: lastAnalysis.duration,
          pauseRatio: lastAnalysis.audio ? lastAnalysis.audio.silentRatio : null,
          dynamicRange: lastAnalysis.audio ? lastAnalysis.audio.dynamicRange : null,
          motionEnergy: lastAnalysis.visual ? lastAnalysis.visual.motionEnergy : null,
          facePresence: lastAnalysis.visual ? lastAnalysis.visual.facePresence : null,
          eyeContactRatio: lastAnalysis.visual ? lastAnalysis.visual.eyeContactRatio : null
        },
        scores: lastAnalysis.rubric.sections,
        videoFrames: lastAnalysis.visual ? lastAnalysis.visual.keyframes : []
      })
    });

    const payload = await response.json();
    if (!response.ok || !payload.ok) {
      throw new Error(payload.error || 'KI-Analyse fehlgeschlagen.');
    }

    renderAiFeedback(payload.data);
    aiStatus.textContent = 'KI-Feedback aktualisiert.';
  } catch (err) {
    aiStatus.textContent = `Fehler: ${err.message}`;
  } finally {
    aiBtn.disabled = false;
  }
});
