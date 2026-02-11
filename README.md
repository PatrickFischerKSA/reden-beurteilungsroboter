# Reden‑Beurteilungsroboter (Eröffnungsrede)

Eine lokale Web‑App, die Eröffnungsreden anhand eines Kriterienrasters bewertet, Messwerte (Zeit/Tempo) liefert und lernförderliche Tipps generiert.

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

- Video‑Upload (bleibt lokal im Browser)
- Transkript‑Eingabe für Wortzählung und Tempo
- Kriterienraster (Inhalt, Form Text, Form Auftritt)
- Automatische Tipps basierend auf Messwerten und Selbsteinschätzung
- Optionale KI‑Auswertung via OpenAI Responses API
- Optionale Videoanalyse (Blickkontakt/Gestik, heuristisch) im Browser
- Bericht als Markdown herunterladen

## Datenschutz

Die App verarbeitet Video und Transkript lokal im Browser. Nur bei aktivierter KI‑Analyse wird das Transkript an die OpenAI API gesendet. citeturn1search0turn1search1

## OpenAI Setup (optional)

Für KI‑Feedback wird ein API‑Key benötigt und serverseitig als Umgebungsvariable gesetzt:

```bash
export OPENAI_API_KEY="sk-..."
export OPENAI_MODEL="gpt-4.1"
```

Die App verwendet den OpenAI Responses API Endpunkt `/v1/responses`. citeturn1search0turn1search1

## Videoanalyse (optional)

Die Videoanalyse nutzt MediaPipe im Browser (CDN). Dafür ist eine Internetverbindung beim Laden der Modelle nötig. Wenn deaktiviert, werden keine CV‑Messwerte berechnet.

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
