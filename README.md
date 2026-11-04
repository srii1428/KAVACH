# KAVACH — Women's Safety & Emergency Alert Platform

> **Protecting Her · Empowering All**  
> A complete, software-first emergency dispatch, guardian monitoring, and personal safety suite.

---

## 🌟 Key Features

1. **🚨 Multi-Mode Emergency SOS**:
   - **Loud Alarm SOS**: Synthesizes an emergency police siren via the Web Audio API with pulsing beacon alerts.
   - **Covert Silent SOS**: Dispatches coordinates silently without triggering alarms or alerting bystanders.
   - **One-Tap WhatsApp & Call Broadcast**: Instantly prepares pre-composed distress messages with your exact live Google Maps coordinates for your trusted contacts.
   - **National Helplines Speed Dial**: Instant 1-tap emergency calling to **112** (National Emergency), **1091** (Women Helpline), **100** (Police Control), and **108** (Ambulance).
   - **Audio Evidence Capture**: Records ambient sound via microphone during active emergencies (`MediaRecorder`) and provides a 1-click download of the audio evidence file.

2. **🗺️ Live GPS & Interactive Map**:
   - Continuous geo-tracking with breadcrumb route trails (`navigator.geolocation.watchPosition`).
   - Landmark and street address search bar (e.g. *Koramangala*, *Indiranagar*, *HSR Layout*).
   - Draggable & clickable pin to fine-tune exact locations.
   - Reverse-geocoded human-readable street address display.

3. **⏱️ "Walk Safe" Guardian Safety Timer**:
   - Ideal for solo commutes, late-night cab rides, or walking unfamiliar routes.
   - Set a safety countdown (5, 15, 30, or 45 minutes) with your destination notes.
   - If you do not check in safely before the timer reaches zero, KAVACH automatically escalates and triggers full emergency SOS broadcast.

4. **📞 Fake Call Escape Simulator**:
   - Provides a discreet reason to exit uncomfortable or threatening situations.
   - Realistic smartphone incoming call screen with synthesized phone ringtone and caller identities (Mom, Dad, Police Control, Manager).
   - When answered, realistic synthesized voice dialogue plays: *"Hey, where are you? We are waiting right outside in the car, please come out immediately!"*

5. **🕵️ Stealth Calculator Disguise**:
   - In situations where holding up a safety app might provoke an aggressor, Stealth Mode masks KAVACH as a working standard calculator.
   - Typing **`911=`** or **`999=`** secretly sends your live GPS coordinates to your trusted contacts without any visual or audio indication on screen.

6. **🏥 Emergency Safe Havens**:
   - One-click discovery of nearby Police Stations, All-Women Police Cells, Trauma Hospitals, and 24/7 Pharmacies with instant turn-by-turn navigation in Google Maps.

7. **📋 Incident History & Official Police Report Export**:
   - Keeps an audit log of all emergency events, timestamps, trigger types, and contact dispatches.
   - One-click **"Export Police Report"** generates a formatted text file ready for police reporting or institutional security review.

8. **📱 Mobile-First Native Experience**:
   - Includes a thumb-friendly bottom app navigation bar, safe-area padding for notches/indicators, dynamic viewport sizing (`100dvh`), and ≥48px touch targets for high-stress usability.

---

## 🚀 How to Run the Project

### Requirements:
- Python 3.8 or higher installed on your computer.

### Step 1: Open Terminal / Command Prompt
Navigate into the extracted folder:
```bash
cd KAVACH
```

### Step 2: Create a Virtual Environment (Recommended)

**On Windows:**
```bash
python -m venv .venv
.\.venv\Scripts\activate
```

**On macOS / Linux:**
```bash
python3 -m venv .venv
source .venv/bin/activate
```

### Step 3: Install Dependencies
```bash
pip install -r requirements.txt
```

### Step 4: Start KAVACH
```bash
python app.py
```
*(On Linux/macOS, you can use `python3 app.py`)*

### Step 5: Open in Your Browser
- Visit **[http://127.0.0.1:5000](http://127.0.0.1:5000)** in Chrome, Edge, Safari, or Firefox.
- To view on your mobile phone on the same Wi-Fi, open `http://<your-computer-ip>:5000`.

---

## 📁 File Structure

```text
KAVACH/
├── app.py                 # Flask REST API, SQLite database, safety timer engine
├── requirements.txt       # Python dependencies (Flask >= 3.0)
├── README.md              # Detailed project guide & documentation
├── README.txt             # Quick start instructions
├── static/
│   ├── app.js             # Client logic (Leaflet GPS, siren audio synth, speech, timer)
│   ├── style.css          # Responsive mobile-first stylesheet & animations
│   └── kavach-logo.png    # Brand shield logo asset
└── templates/
    └── index.html         # Single-page application dashboard layout
```

---

## 🔒 Privacy & Safety Note
All contacts, safety timers, and emergency audit logs are stored securely in a local SQLite database (`kavach.db`). No sensitive personal data or location coordinates are uploaded to external tracking servers.
