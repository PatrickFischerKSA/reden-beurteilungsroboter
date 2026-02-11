const videoInput = document.getElementById('videoInput');
const videoPreview = document.getElementById('videoPreview');
const videoMeta = document.getElementById('videoMeta');
const analysisStatus = document.getElementById('analysisStatus');
const featureStatus = document.getElementById('featureStatus');
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
let metadataLoaded = false;
let detectorMode = 'none';
let nativeFaceDetector = null;
let mediaPipeFaceDetector = null;

function getApiBaseCandidates() {
  const candidates = [];
  const origin = window.location.origin;
  if (origin && origin !== 'null') candidates.push(origin);
  if (!origin.includes('localhost:3000')) candidates.push('http://localhost:3000');
  return [...new Set(candidates)];
}

async function postJsonWithFallback(path, payload) {
  const bases = getApiBaseCandidates();
  let lastError = null;

  for (const base of bases) {
    const url = `${base}${path}`;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const parsed = await safeJsonResponse(response);
      if (response.ok && parsed.data) {
        return { ok: true, payload: parsed.data, url };
      }

      if (response.status === 404 || response.status === 405) {
        lastError = `API an ${url} nicht verfuegbar (${response.status}).`;
        continue;
      }

      const msg = parsed.data?.error || parsed.raw?.slice(0, 200) || `HTTP ${response.status}`;
      return { ok: false, error: `${url}: ${msg}`, url };
    } catch (err) {
      lastError = `${url}: ${err.message}`;
    }
  }

  return { ok: false, error: lastError || 'Keine API erreichbar.' };
}

function setFeatureStatus(opts = {}) {
  const face = opts.face || (detectorMode === 'none' ? 'nicht verfuegbar' : detectorMode);
  const audio = opts.audio || 'bereit';
  const frames = opts.frames || 'bereit';
  featureStatus.textContent = `FaceDetector: ${face} · Audioanalyse: ${audio} · Keyframes: ${frames}`;
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

function downsampleTo16k(float32, sourceRate) {
  const targetRate = 16000;
  if (sourceRate === targetRate) return float32;
  const ratio = sourceRate / targetRate;
  const outLength = Math.floor(float32.length / ratio);
  const out = new Float32Array(outLength);
  for (let i = 0; i < outLength; i += 1) {
    const src = Math.floor(i * ratio);
    out[i] = float32[src] || 0;
  }
  return out;
}

function pcm16ToWavBuffer(samples, sampleRate) {
  const bytesPerSample = 2;
  const blockAlign = bytesPerSample;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  function writeString(offset, str) {
    for (let i = 0; i < str.length; i += 1) {
      view.setUint8(offset + i, str.charCodeAt(i));
    }
  }

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i += 1) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    offset += 2;
  }

  return buffer;
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

async function extractWavBase64(file) {
  const arrayBuffer = await file.arrayBuffer();
  const audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  const source = decoded.getChannelData(0);
  const maxSeconds = 210;
  const maxSamples = Math.min(source.length, Math.floor(decoded.sampleRate * maxSeconds));
  const sliced = source.slice(0, maxSamples);
  const downsampled = downsampleTo16k(sliced, decoded.sampleRate);
  const wavBuffer = pcm16ToWavBuffer(downsampled, 16000);
  await audioContext.close();
  return arrayBufferToBase64(wavBuffer);
}

async function analyzeAudio(file) {
  if (!file) return null;
  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const channel = audioBuffer.getChannelData(0);

    const step = 2048;
    let silent = 0;
    let sum = 0;
    let peak = 0;

    for (let i = 0; i < channel.length; i += step) {
      const sample = Math.abs(channel[i]);
      sum += sample;
      if (sample < 0.02) silent += 1;
      if (sample > peak) peak = sample;
    }

    const frames = Math.max(1, Math.floor(channel.length / step));
    const avgVolume = sum / frames;
    const silentRatio = silent / frames;
    const dynamicRange = Math.max(0, peak - avgVolume);

    await audioContext.close();
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

async function initFaceEngine() {
  if (window.FaceDetector) {
    try {
      const candidate = new window.FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      if (candidate && typeof candidate.detect === 'function') {
        nativeFaceDetector = candidate;
        detectorMode = 'native';
        return;
      }
    } catch (_err) {
      nativeFaceDetector = null;
    }
  }

  if (!window.FilesetResolver || !window.FaceDetector || typeof window.FaceDetector.createFromOptions !== 'function') {
    detectorMode = 'nicht verfuegbar';
    return;
  }

  try {
    const vision = await window.FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );

    mediaPipeFaceDetector = await window.FaceDetector.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite'
      },
      runningMode: 'IMAGE',
      minDetectionConfidence: 0.45
    });

    detectorMode = 'mediapipe';
  } catch (_err) {
    detectorMode = 'nicht verfuegbar';
    mediaPipeFaceDetector = null;
  }
}

async function detectFaces(canvas, width, height) {
  if (detectorMode === 'native' && nativeFaceDetector) {
    try {
      const faces = await nativeFaceDetector.detect(canvas);
      return faces.map((f) => {
        const box = f.boundingBox;
        return {
          cx: (box.x + box.width / 2) / width,
          cy: (box.y + box.height / 2) / height,
          area: (box.width * box.height) / (width * height)
        };
      });
    } catch (_err) {
      return [];
    }
  }

  if (detectorMode === 'mediapipe' && mediaPipeFaceDetector) {
    try {
      const result = mediaPipeFaceDetector.detect(canvas);
      const detections = result?.detections || [];
      return detections.map((d) => {
        const b = d.boundingBox;
        return {
          cx: (b.originX + b.width / 2) / width,
          cy: (b.originY + b.height / 2) / height,
          area: (b.width * b.height) / (width * height)
        };
      });
    } catch (_err) {
      return [];
    }
  }

  return [];
}

async function analyzeVideoFrames(onProgress) {
  const duration = getVideoDuration();
  if (!duration) return null;

  const width = 224;
  const height = 126;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });

  const sampleCount = Math.min(80, Math.max(28, Math.ceil(duration / 1.6)));
  const interval = duration / sampleCount;
  const keyframeSteps = new Set([0, Math.floor(sampleCount * 0.2), Math.floor(sampleCount * 0.4), Math.floor(sampleCount * 0.6), Math.floor(sampleCount * 0.8), sampleCount - 1]);

  const keyframes = [];
  let previous = null;
  let motionSum = 0;
  let motionFrames = 0;
  let faceDetected = 0;
  let eyeCentered = 0;
  let faceAreaSum = 0;

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

    const faces = await detectFaces(canvas, width, height);
    if (faces.length) {
      const f = faces[0];
      faceDetected += 1;
      faceAreaSum += f.area;
      if (Math.abs(f.cx - 0.5) < 0.18 && Math.abs(f.cy - 0.45) < 0.22) {
        eyeCentered += 1;
      }
    }

    if (keyframeSteps.has(i)) {
      keyframes.push({
        timeSec: Math.round(t),
        dataUrl: canvas.toDataURL('image/jpeg', 0.62)
      });
    }

    if (onProgress) onProgress(i + 1, sampleCount);
  }

  await seekTo(originalTime);
  if (!wasPaused) videoPreview.play().catch(() => {});

  const facePresence = faceDetected / sampleCount;
  const eyeContactRatio = faceDetected ? eyeCentered / faceDetected : 0;
  const meanFaceArea = faceDetected ? faceAreaSum / faceDetected : 0;
  const motionEnergy = motionFrames ? motionSum / motionFrames : 0;

  return {
    motionEnergy,
    facePresence,
    eyeContactRatio,
    meanFaceArea,
    keyframes,
    sampleCount,
    detectorAvailable: detectorMode === 'native' || detectorMode === 'mediapipe'
  };
}

function autoScore({ duration, audio, visual }) {
  let score = 0;
  let max = 0;

  max += 1.4;
  if (duration >= 120 && duration <= 180) score += 1.4;
  else if (duration >= 90 && duration <= 210) score += 0.7;

  max += 1.2;
  if (audio) {
    if (audio.silentRatio >= 0.18 && audio.silentRatio <= 0.38) score += 1.2;
    else score += 0.6;
  }

  max += 1.1;
  if (visual) {
    if (visual.motionEnergy >= 0.01 && visual.motionEnergy <= 0.055) score += 1.1;
    else if (visual.motionEnergy > 0.004) score += 0.6;
  }

  max += 1.3;
  if (visual && visual.facePresence >= 0.6) score += 1.3;
  else if (visual && visual.facePresence >= 0.4) score += 0.7;

  max += 1.0;
  if (visual && visual.eyeContactRatio >= 0.55) score += 1.0;
  else if (visual && visual.eyeContactRatio >= 0.35) score += 0.5;

  if (!max) return 0;
  return (score / max) * 5;
}

function buildFeedback({ duration, audio, visual }) {
  const feedback = [];

  if (!duration) {
    feedback.push('Kein Video erkannt. Bitte zuerst ein Video hochladen.');
    return feedback;
  }

  if (duration < 120) feedback.push('Rede ist zu kurz fuer das Ziel (2-3 Minuten). Erweitere Argumente mit Beispiel und Gegenargument.');
  if (duration > 180) feedback.push('Rede ist zu lang fuer das Ziel (2-3 Minuten). Straffe Einleitung und Nebenpunkte.');
  if (duration >= 120 && duration <= 180) feedback.push('Zeitfenster 2-3 Minuten ist erreicht.');

  if (audio) {
    if (audio.silentRatio < 0.18) feedback.push('Wenig Pausen erkennbar. Setze nach Kernaussagen kurze Sprechpausen.');
    if (audio.silentRatio > 0.38) feedback.push('Viele laengere Pausen erkennbar. Verbinde Argumente mit klaren Uebergaengen.');
    if (audio.dynamicRange < 0.08) feedback.push('Stimmliche Dynamik wirkt flach. Arbeite mit Betonung und Lautstaerkewechseln.');
  } else {
    feedback.push('Audio konnte nicht ausgewertet werden. Pruefe, ob das Video eine Tonspur enthaelt.');
  }

  if (visual) {
    if (visual.motionEnergy < 0.01) feedback.push('Sehr wenig koerperliche Bewegung. Nutze Gestik zur Strukturierung.');
    if (visual.motionEnergy > 0.06) feedback.push('Sehr hohe Bewegungsenergie. Reduziere Unruhe und halte Standphasen laenger.');

    if (!visual.detectorAvailable) {
      feedback.push('Gesichtserkennung in diesem Browser nicht verfuegbar. Nutze Chrome/Edge oder aktiviere KI-Feedback.');
    } else {
      if (visual.facePresence < 0.55) feedback.push('Gesicht ist nicht durchgaengig gut sichtbar. Kamerahoehe und Bildausschnitt verbessern.');
      if (visual.eyeContactRatio < 0.5) feedback.push('Blickkontakt wirkt wechselhaft. Blick haeufiger in Richtung Kamera halten.');
      if (visual.meanFaceArea < 0.05) feedback.push('Abstand zur Kamera ist eher gross. Etwas naeher positionieren verbessert Mimiklesbarkeit.');
    }
  }

  feedback.push('Inhaltliches Detailfeedback wird im Abschnitt "KI-Feedback" automatisch per Audio-Transkription erzeugt.');
  feedback.push('Naechster Lernschritt: eine konkrete Stellschraube waehlen, neu aufnehmen und direkt vergleichen.');
  return feedback;
}

function updateScoreboard({ duration, audio, visual }) {
  timeScoreEl.textContent = duration ? formatTime(duration) : '-';
  tempoScoreEl.textContent = tempoLabel(audio);
  pauseScoreEl.textContent = audio ? `${Math.round(audio.silentRatio * 100)}%` : '-';

  gestureScoreEl.textContent = visual && visual.motionEnergy !== undefined ? visual.motionEnergy.toFixed(3) : '-';
  faceScoreEl.textContent = visual ? `${Math.round((visual.facePresence || 0) * 100)}%` : '-';
  eyeScoreEl.textContent = visual ? `${Math.round((visual.eyeContactRatio || 0) * 100)}%` : '-';

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
  lines.push(`- Gesicht im Bild: ${data.visual ? Math.round((data.visual.facePresence || 0) * 100) + '%' : '-'}`);
  lines.push(`- Blickkontakt (Proxy): ${data.visual ? Math.round((data.visual.eyeContactRatio || 0) * 100) + '%' : '-'}`);
  lines.push('');
  lines.push('## Feedback');
  data.feedback.forEach((tip) => lines.push(`- ${tip}`));
  return lines.join('\n');
}

function renderAiFeedback(data) {
  aiFeedback.innerHTML = '';
  if (!data) return;

  const container = document.createElement('div');

  const sections = [
    { title: 'Kurzfazit', key: 'summary', type: 'text' },
    { title: 'Rhetorisches Feedback', key: 'rhetorical_feedback', type: 'list' },
    { title: 'Inhaltliches Feedback', key: 'content_feedback', type: 'list' },
    { title: 'Staerken', key: 'strengths', type: 'list' },
    { title: 'Verbesserungen', key: 'improvements', type: 'list' },
    { title: 'Tipps', key: 'tips', type: 'list' },
    { title: 'Naechste Schritte', key: 'next_steps', type: 'list' }
  ];

  sections.forEach((section) => {
    if (section.type === 'text' && data[section.key]) {
      const h = document.createElement('h3');
      h.textContent = section.title;
      const p = document.createElement('p');
      p.textContent = data[section.key];
      container.appendChild(h);
      container.appendChild(p);
    }

    if (section.type === 'list' && Array.isArray(data[section.key]) && data[section.key].length) {
      const h = document.createElement('h3');
      h.textContent = section.title;
      const ul = document.createElement('ul');
      data[section.key].forEach((entry) => {
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

async function safeJsonResponse(response) {
  const raw = await response.text();
  try {
    return { data: JSON.parse(raw), raw };
  } catch (_err) {
    return { data: null, raw };
  }
}

async function runLocalAnalysis() {
  if (!currentVideoFile || !getVideoDuration()) {
    analysisStatus.textContent = 'Bitte zuerst ein abspielbares Video laden.';
    return;
  }

  analyzeBtn.disabled = true;
  analyzeBtn.textContent = 'Analyse laeuft...';
  analysisStatus.textContent = 'Audioanalyse laeuft...';
  setFeatureStatus({ face: detectorMode, audio: 'laeuft', frames: 'wartet' });

  audioMetrics = await analyzeAudio(currentVideoFile);
  setFeatureStatus({
    face: detectorMode,
    audio: audioMetrics ? 'ok' : 'nicht verfuegbar',
    frames: 'laeuft'
  });

  analysisStatus.textContent = 'Video wird ausgewertet...';
  visualMetrics = await analyzeVideoFrames((step, total) => {
    analysisStatus.textContent = `Videoanalyse: ${step}/${total} Frames`;
  });

  setFeatureStatus({
    face: visualMetrics && visualMetrics.detectorAvailable ? detectorMode : 'nicht verfuegbar',
    audio: audioMetrics ? 'ok' : 'nicht verfuegbar',
    frames: visualMetrics ? `ok (${visualMetrics.keyframes.length} Keyframes)` : 'nicht verfuegbar'
  });

  const duration = getVideoDuration();
  const score = autoScore({ duration, audio: audioMetrics, visual: visualMetrics });
  const feedback = buildFeedback({ duration, audio: audioMetrics, visual: visualMetrics });

  totalScoreEl.textContent = score.toFixed(1);
  updateScoreboard({ duration, audio: audioMetrics, visual: visualMetrics });
  feedbackEl.innerHTML = `<ul>${feedback.map((tip) => `<li>${tip}</li>`).join('')}</ul>`;
  analysisStatus.textContent = 'Analyse abgeschlossen.';

  lastAnalysis = {
    duration,
    audio: audioMetrics,
    visual: visualMetrics,
    feedback,
    score
  };

  analyzeBtn.disabled = false;
  analyzeBtn.textContent = 'Video erneut analysieren';
}

function handleVideoLoadFailure() {
  const ext = currentVideoFile?.name?.split('.').pop()?.toLowerCase() || '';
  const movHint = ext === 'mov' ? ' MOV wird in manchen Browsern nicht dekodiert. Exportiere als MP4 (H.264 + AAC).' : '';
  analysisStatus.textContent = `Video konnte nicht verarbeitet werden.${movHint}`;
  videoMeta.textContent = currentVideoFile ? `Datei: ${currentVideoFile.name} · nicht abspielbar` : 'Noch kein Video geladen.';
}

async function getAutoTranscript() {
  if (!currentVideoFile) return '';

  try {
    aiStatus.textContent = 'Audio wird fuer Transkription vorbereitet...';
    const audioBase64 = await extractWavBase64(currentVideoFile);
    const result = await postJsonWithFallback('/api/transcribe-audio', { audioBase64, language: 'de' });
    if (!result.ok || !result.payload?.ok) {
      throw new Error(result.error || 'Transkriptionsfehler');
    }
    return result.payload.transcript || '';
  } catch (err) {
    aiStatus.textContent = `Transkription nicht verfuegbar: ${err.message}`;
    return '';
  }
}

async function init() {
  if (window.location.protocol === 'file:') {
    analysisStatus.textContent = 'Hinweis: KI-Funktionen brauchen den Server (npm start, dann localhost:3000).';
  }

  analysisStatus.textContent = 'Initialisiere Gesichtserkennung...';
  await initFaceEngine();
  setFeatureStatus({ face: detectorMode, audio: 'bereit', frames: 'bereit' });
  analysisStatus.textContent = 'Warte auf Video.';
}

videoInput.addEventListener('change', async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  currentVideoFile = file;
  metadataLoaded = false;

  const url = URL.createObjectURL(file);
  videoPreview.src = url;
  videoPreview.load();

  videoMeta.textContent = `Datei: ${file.name} · wird geladen...`;
  analysisStatus.textContent = 'Video wird vorbereitet...';

  setTimeout(() => {
    if (!metadataLoaded) {
      handleVideoLoadFailure();
    }
  }, 6000);
});

videoPreview.addEventListener('loadedmetadata', async () => {
  metadataLoaded = true;
  videoMeta.textContent = `Datei: ${currentVideoFile.name} · Dauer: ${formatTime(videoPreview.duration)}`;
  analysisStatus.textContent = 'Video geladen. Starte automatische Analyse...';
  await runLocalAnalysis();
});

videoPreview.addEventListener('error', () => {
  metadataLoaded = false;
  handleVideoLoadFailure();
});

videoPreview.addEventListener('stalled', () => {
  if (!metadataLoaded) handleVideoLoadFailure();
});

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
  aiStatus.textContent = 'Inhaltliches und rhetorisches KI-Feedback wird erzeugt...';
  aiFeedback.innerHTML = '';

  try {
    const transcript = await getAutoTranscript();
    const result = await postJsonWithFallback('/api/ai-feedback', {
      transcript,
      metrics: {
        duration: lastAnalysis.duration,
        pauseRatio: lastAnalysis.audio ? lastAnalysis.audio.silentRatio : null,
        dynamicRange: lastAnalysis.audio ? lastAnalysis.audio.dynamicRange : null,
        motionEnergy: lastAnalysis.visual ? lastAnalysis.visual.motionEnergy : null,
        facePresence: lastAnalysis.visual ? lastAnalysis.visual.facePresence : null,
        eyeContactRatio: lastAnalysis.visual ? lastAnalysis.visual.eyeContactRatio : null
      },
      videoFrames: lastAnalysis.visual ? lastAnalysis.visual.keyframes : []
    });

    if (!result.ok || !result.payload?.ok) {
      throw new Error(result.error || 'KI-Analyse fehlgeschlagen.');
    }

    renderAiFeedback(result.payload.data);
    aiStatus.textContent = 'KI-Feedback aktualisiert (rhetorisch + inhaltlich).';
  } catch (err) {
    aiStatus.textContent = `Fehler: ${err.message}`;
  } finally {
    aiBtn.disabled = false;
  }
});

init().catch(() => {
  detectorMode = 'nicht verfuegbar';
  setFeatureStatus({ face: detectorMode });
  analysisStatus.textContent = 'Warte auf Video.';
});
