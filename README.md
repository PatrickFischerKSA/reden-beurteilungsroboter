# Reden-Beurteilungsroboter (Eroeffnungsrede)

Eine lokale Web-App, die Eroeffnungsreden ausschliesslich ueber den Videoauftritt bewertet und lernfoerderliche Tipps erzeugt.

## Schnellstart

```bash
npm install
npm start
```

Dann im Browser öffnen:

```
http://localhost:3000
```

## Features

- Automatische Analyse direkt nach Video-Upload
- Videozentrierte Messwerte (Dauer, Pausenanteil, Bewegungsenergie)
- Blickkontakt/Gesicht-Metrik, wenn der Browser Face-Detection unterstuetzt
- Kriterienraster (Inhalt, Form Text, Form Auftritt)
- Automatische Tipps basierend auf Videoanalyse und optionaler Selbsteinschaetzung
- Optionale KI-Auswertung via OpenAI Responses API mit Keyframes
- Bericht als Markdown herunterladen

## Datenschutz

Die lokale Analyse verarbeitet das Video im Browser. Bei aktivierter KI-Analyse werden Keyframes und Messwerte an die OpenAI API gesendet.

## OpenAI Setup (optional)

Default ist jetzt eine lokale Datei `.env.local` im Projektordner.
Trage dort deinen Key einmal ein, dann ist kein `export` pro Session mehr noetig:

```bash
OPENAI_API_KEY_DEFAULT="sk-..."
OPENAI_MODEL="gpt-4.1"
OPENAI_TRANSCRIBE_MODEL="gpt-4o-mini-transcribe"
```

Sicherer auf macOS (empfohlen): Key im Keychain speichern.
Dann wird er bei jedem Aufruf serverseitig geladen, ohne dass er im Browser landet:

```bash
security add-generic-password -a "$USER" -s "reden-beurteilungsroboter-openai" -w "sk-..." -U
```

## Videoanalyse (optional)

Die Videoanalyse laeuft lokal mit Canvas-Frame-Auswertung. Face-Detection nutzt die Browser-API, falls vorhanden.

## GitHub Veröffentlichung

Dieses Projekt ist bereit für GitHub. Typischer Ablauf:

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin <DEIN_GITHUB_REPO>
git push -u origin main
```
