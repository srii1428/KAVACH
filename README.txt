# KAVACH — Women's Safety & Emergency Alert Platform

Protecting Her · Empowering All
A complete, software-first emergency dispatch, guardian monitoring, and personal safety suite.

============================================================
1. QUICK START INSTRUCTIONS
============================================================

On Windows:
1. Extract the zip folder.
2. Open the KAVACH folder in Terminal / Command Prompt:
   cd KAVACH
3. Create and activate a virtual environment:
   py -m venv .venv
   .\.venv\Scripts\activate
4. Install dependencies:
   pip install -r requirements.txt
5. Run the server:
   python app.py
6. Open http://127.0.0.1:5000 in your browser.

On macOS / Linux:
1. Extract the zip folder.
2. Open terminal in the KAVACH folder:
   cd KAVACH
3. Create and activate a virtual environment:
   python3 -m venv .venv
   source .venv/bin/activate
4. Install dependencies:
   pip install -r requirements.txt
5. Run the server:
   python3 app.py
6. Open http://127.0.0.1:5000 in your browser.

============================================================
2. KEY FEATURES INCLUDED
============================================================
1. Multi-Mode Emergency SOS:
   - Loud Alarm SOS with synthesized dual-tone siren
   - Covert Silent SOS (dispatches alerts without sound/flashes)
   - 1-click WhatsApp distress messages with live Google Maps link
   - Instant speed-dials for 112, 1091, 100, and 108
   - Ambient audio evidence recording via microphone
2. Live GPS & Interactive Map:
   - Continuous live geo-tracking with route polyline
   - Address search bar & draggable/clickable pin
   - Reverse geocoded human-readable street address display
3. "Walk Safe" Guardian Safety Timer:
   - 5-45 minute countdown with auto-escalation to SOS if you don't check in
4. Fake Call Simulator:
   - Realistic smartphone incoming call screen with ringtone and synthesized voice
5. Stealth Calculator Disguise:
   - Working calculator that secretly triggers SOS when you type 911=
6. Emergency Safe Havens:
   - 1-click navigation to nearest police stations, hospitals, and pharmacies
7. Incident History & Official Police Report Export:
   - Export structured .txt report ready for authorities
8. Mobile-First Optimization:
   - Thumb-friendly bottom app bar and safe-area support
