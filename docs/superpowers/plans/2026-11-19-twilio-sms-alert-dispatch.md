# Twilio SMS Emergency Alert Dispatch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace WhatsApp manual 1-tap links in KAVACH with automatic background cellular SMS emergency broadcasts powered by Twilio, featuring phone normalization, helpline short-code routing, delivery status tracking, and resilient fallbacks.

**Architecture:** The Flask backend (`app.py`) parses and routes contacts on `POST /api/sos`. Helpline numbers ($\le 5$ digits) route to direct phone speed-dials, while cellular contacts are normalized to E.164 and dispatched concurrently via Twilio's REST API using Python's `concurrent.futures.ThreadPoolExecutor`. The frontend dashboard (`templates/index.html` and `static/app.js`) removes WhatsApp popups and renders real-time SMS delivery status badges with 1-tap native SMS fallback.

**Tech Stack:** Python 3.10+, Flask 3.x, SQLite, Twilio REST API (using standard library `urllib` / `base64` for zero-dependency portability), Vanilla JavaScript (ES6+), HTML5/CSS3.

**Spec:** [`docs/superpowers/specs/2026-11-19-twilio-sms-alert-dispatch-design.md`](file:///home/naveen/Downloads/KAVACH/docs/superpowers/specs/2026-11-19-twilio-sms-alert-dispatch-design.md)

---

## Global Constraints

- **Zero-Dependency Core:** Use Python's built-in `urllib.request` and `base64` for Twilio REST communication to maintain instant serverless cold starts on Vercel without requiring extra wheel builds.
- **Life-Safety Invariant:** Never block SOS or siren execution on Twilio network latency; dispatch must run concurrently with a strict 4-second timeout per contact.
- **Fail-Safe Fallback:** If Twilio is unconfigured or returns an error, always supply a `fallback_sms_url` (`sms:phone?body=...`) so the user can send via their carrier in 1 tap.
- **Short-Code Safety:** Telecommunication carriers reject SMS to emergency helplines (`112`, `100`, `1091`). Numbers with $\le 5$ digits must never be dispatched to Twilio and must route to speed-dial actions (`tel:`).
- **Environment Isolation:** Read `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` from environment variables; operate in safe simulation mode when unset.

## Review Focus

1. **Short-code contact input:** A user has `112` or `100` in their emergency contacts; normalization must route it to helpline speed-dial without raising validation errors or attempting Twilio SMS.
2. **Missing Twilio credentials:** Server started with empty `TWILIO_*` environment variables; `POST /api/sos` must succeed with status `"simulated"`, returning 200 OK without exceptions.
3. **Double-tap rapid re-trigger:** User taps SOS button twice within 5 seconds; the second invocation updates coordinates but suppresses duplicate Twilio SMS dispatches via the 30-second cooldown window.
4. **Invalid non-standard phone numbers:** User has spaces, parentheses, or a leading `0` (e.g. `09876543210` or `+91 (987) 654-3210`); normalization must output clean E.164 (`+919876543210`).
5. **Twilio API failure / network timeout:** Twilio endpoint returns HTTP 400 (e.g., unverified trial recipient) or times out; backend captures the error, returns `status="failed"` with `fallback_sms_url`, and the UI renders the amber fallback button.

---

### Task 1: Phone Normalization, Helpline Routing & Twilio Dispatch Engine

**Files:**
- Modify: `app.py:194-275`
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: Raw phone strings, message text, environment variables (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`, `TWILIO_DEFAULT_COUNTRY`).
- Produces:
  - `normalize_and_route_contact(phone_str: str, default_country: str = "+91") -> dict`: returns `{"route": "CELLULAR"|"HELPLINE"|"INVALID", "phone": str, "error": str|None}`.
  - `send_twilio_sms(to_phone: str, message: str) -> dict`: returns `{"ok": bool, "status": "sent"|"queued"|"simulated"|"failed", "sid": str|None, "error": str|None, "provider": str}`.

- [ ] **Step 1: Write failing unit tests for normalization and Twilio engine**

Add tests to `tests/test_api.py`:
```python
def test_normalize_and_route_contact(self):
    # Short-code helplines
    res112 = app.normalize_and_route_contact("112")
    self.assertEqual(res112["route"], "HELPLINE")
    self.assertEqual(res112["phone"], "112")

    # 10-digit standard Indian mobile
    res10 = app.normalize_and_route_contact("9876543210")
    self.assertEqual(res10["route"], "CELLULAR")
    self.assertEqual(res10["phone"], "+919876543210")

    # 11-digit mobile with leading 0
    res0 = app.normalize_and_route_contact("09876543210")
    self.assertEqual(res0["route"], "CELLULAR")
    self.assertEqual(res0["phone"], "+919876543210")

    # International number with existing +
    res_intl = app.normalize_and_route_contact("+1 (555) 234-5678")
    self.assertEqual(res_intl["route"], "CELLULAR")
    self.assertEqual(res_intl["phone"], "+15552345678")

    # Invalid garbage number
    res_inv = app.normalize_and_route_contact("abc")
    self.assertEqual(res_inv["route"], "INVALID")

def test_send_twilio_sms_simulated(self):
    # When credentials are not set, it should simulate dispatch
    res = app.send_twilio_sms("+919876543210", "Test Emergency Alert")
    self.assertTrue(res["ok"])
    self.assertEqual(res["status"], "simulated")
    self.assertEqual(res["provider"], "Simulated")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py -k "test_normalize_and_route_contact or test_send_twilio_sms_simulated" -v`  
Expected: FAILED (AttributeError: `normalize_and_route_contact` does not exist).

- [ ] **Step 3: Implement `normalize_and_route_contact` and `send_twilio_sms` in `app.py`**

In `app.py`:
1. Implement `normalize_and_route_contact(phone_str, default_country="+91")`:
   - Strip all non-digit and non-`+` characters.
   - If clean digits count is between 1 and 5 inclusive, return `{"route": "HELPLINE", "phone": digits, "error": None}`.
   - If starts with `0` and has 11 digits, strip leading `0` and prepend `default_country`.
   - If exactly 10 digits, prepend `default_country`.
   - If starts with `+` and has 10–15 digits, keep as valid E.164.
   - Otherwise return `{"route": "INVALID", "phone": phone_str, "error": "Invalid phone number length"}`.
2. Refactor `send_twilio_sms(to_phone, message)`:
   - Check `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_PHONE_NUMBER`.
   - If missing, return `{"ok": True, "status": "simulated", "sid": None, "error": None, "provider": "Simulated"}`.
   - If present, build Basic auth header and POST to `https://api.twilio.com/2010-04-01/Accounts/{sid}/Messages.json` with a 4.0 second timeout.
   - Parse response JSON: if HTTP 200/201, extract `sid` and `status` (`queued`/`sent`); if HTTP 4xx/5xx or `urllib.error.HTTPError`, return `{"ok": False, "status": "failed", "sid": None, "error": str(err), "provider": "Twilio"}`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_api.py -k "test_normalize_and_route_contact or test_send_twilio_sms_simulated" -v`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_api.py
git commit -m "feat(sms): implement contact normalization, helpline routing, and Twilio dispatch engine"
```

---

### Task 2: Concurrent SMS Broadcast & Cooldown Deduplication in `/api/sos`

**Files:**
- Modify: `app.py:380-460`
- Test: `tests/test_api.py`

**Interfaces:**
- Consumes: `POST /api/sos` payload (`latitude`, `longitude`, `contacts`, `trigger_type`, `is_silent`).
- Produces: JSON response with `dispatches` list containing real-time SMS dispatch status and fallback URLs.

- [ ] **Step 1: Write failing unit tests for `/api/sos` SMS dispatch and cooldown**

Add tests to `tests/test_api.py`:
```python
def test_sos_dispatches_sms_structured(self):
    # Add a contact
    self.client.post("/api/contacts", json={"name": "Guardian", "phone": "9876543210"})
    
    # Trigger SOS
    res = self.client.post("/api/sos", json={"latitude": 12.9716, "longitude": 77.5946})
    self.assertEqual(res.status_code, 200)
    data = res.get_json()
    self.assertTrue(data["ok"])
    self.assertEqual(data["status"], "ACTIVE")
    self.assertIn("dispatches", data)
    self.assertEqual(len(data["dispatches"]), 1)
    
    dispatch = data["dispatches"][0]
    self.assertEqual(dispatch["contact_name"], "Guardian")
    self.assertEqual(dispatch["contact_phone"], "+919876543210")
    self.assertEqual(dispatch["channel"], "SMS")
    self.assertEqual(dispatch["status"], "simulated")
    self.assertIn("sms:+919876543210", dispatch["fallback_sms_url"])
    self.assertIn("tel:+919876543210", dispatch["call_url"])

def test_sos_deduplication_cooldown(self):
    # Trigger first SOS
    res1 = self.client.post("/api/sos", json={"latitude": 12.9716, "longitude": 77.5946})
    self.assertEqual(res1.status_code, 200)
    
    # Trigger second SOS immediately (within 30-sec window)
    res2 = self.client.post("/api/sos", json={"latitude": 12.9717, "longitude": 77.5947})
    self.assertEqual(res2.status_code, 200)
    data2 = res2.get_json()
    self.assertTrue(data2["ok"])
    # Dispatches should be marked as suppressed to prevent duplicate SMS
    for d in data2["dispatches"]:
        self.assertEqual(d["status"], "cooldown_suppressed")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pytest tests/test_api.py -k "test_sos_dispatches_sms_structured or test_sos_deduplication_cooldown" -v`  
Expected: FAILED (AssertionError or missing fields).

- [ ] **Step 3: Update `POST /api/sos` in `app.py`**

In `app.py`:
1. Check cooldown: Track `last_dispatch_time` on the emergency row. If existing emergency is `ACTIVE` and `(now - last_dispatch_time) < 30` seconds, set `is_cooldown = True`.
2. Prepare dispatches: For each contact:
   - Call `normalize_and_route_contact(contact["phone"])`.
   - If route is `HELPLINE`: set `status="helpline_speed_dial"`, `channel="CALL"`, skip Twilio dispatch.
   - If route is `INVALID`: set `status="invalid_phone"`, `channel="SMS"`, skip Twilio dispatch.
   - If route is `CELLULAR`:
     - If `is_cooldown`: set `status="cooldown_suppressed"`, `channel="SMS"`.
     - Else: dispatch via `concurrent.futures.ThreadPoolExecutor(max_workers=5)` calling `send_twilio_sms(norm_phone, alert_msg)`.
   - Build dispatch record:
     ```python
     {
         "contact_name": contact["name"],
         "contact_phone": norm_phone,
         "channel": "SMS",
         "status": result["status"],
         "sid": result.get("sid"),
         "error": result.get("error"),
         "fallback_sms_url": f"sms:{norm_phone}?body={encoded_msg}",
         "call_url": f"tel:{norm_phone}",
         "message": alert_msg
     }
     ```
3. Update `alert_logs` with channel `SMS` and delivery status.
4. Return `dispatches` array in `jsonify(ok=True, emergency_id=emergency_id, status="ACTIVE", dispatches=dispatches, ...)`.

- [ ] **Step 4: Run test to verify it passes**

Run: `pytest tests/test_api.py -k "test_sos_dispatches_sms_structured or test_sos_deduplication_cooldown" -v`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_api.py
git commit -m "feat(sos): add concurrent Twilio SMS broadcast and 30-second cooldown deduplication"
```

---

### Task 3: Frontend Modernization & Delivery Status Badges

**Files:**
- Modify: `templates/index.html:1665-1720, 1785-1810`
- Modify: `static/app.js:450-510, 1110-1130`
- Modify: `static/style.css`

**Interfaces:**
- Consumes: `dispatches` payload from `POST /api/sos`.
- Produces: UI with SMS badges, 1-tap SMS fallback buttons, removal of WhatsApp popups, and SMS contact actions.

- [ ] **Step 1: Update UI headers, copy, and pills in `templates/index.html`**

1. Change eyebrow: `<p class="eyebrow">CELLULAR SMS & EMERGENCY DISPATCH</p>`.
2. Change title: `<h2>Emergency SMS Broadcast Hub</h2>`.
3. Change status pill: `<span class="pill light" id="dispatchPill" style="background:rgba(56,189,248,0.15);color:#38bdf8;border-color:rgba(56,189,248,0.4);">SMS BROADCAST READY</span>`.
4. Update description text from WhatsApp to cellular SMS with Google Maps pin.
5. In contact cards and alert lists, replace WhatsApp icon `💬` with SMS icon `✉️` linking to `sms:phone`.

- [ ] **Step 2: Update dispatch rendering and remove WhatsApp popup in `static/app.js`**

1. In `triggerSOS()` / `handleSOSResponse(data)`:
   - **Delete** `window.open(data.dispatches[0].whatsapp_url, '_blank')` completely so no unwanted popups appear.
2. In `renderDispatches(dispatches)`:
   - For `status === "sent"` or `"queued"`: render `<span class="dispatch-badge badge-sent">📨 SMS Sent via Twilio</span>`.
   - For `status === "simulated"`: render `<span class="dispatch-badge badge-simulated">🧪 SMS Simulated (Dev Mode)</span>`.
   - For `status === "helpline_speed_dial"`: render `<a href="${d.call_url}" class="dispatch-btn call-btn">📞 Speed Dial Helpline</a>`.
   - For `status === "failed"` or `"invalid_phone"`: render `<span class="dispatch-badge badge-failed">⚠️ Delivery Issue</span> <a href="${d.fallback_sms_url}" class="dispatch-btn fallback-sms-btn">💬 1-Tap SMS Fallback</a>`.
   - For `status === "cooldown_suppressed"`: render `<span class="dispatch-badge badge-cooldown">⏱️ Alert Already Active</span>`.
   - Always retain the `<a href="${d.call_url}" class="dispatch-btn call-btn">📞 Call</a>` button for direct phone dialing.
3. In contact list card rendering:
   - Replace WhatsApp button with `✉️` (linking to `sms:${encodeURIComponent(res.phone)}?body=KAVACH%20Emergency%20Contact%20Verification`).

- [ ] **Step 3: Add styling in `static/style.css` for dispatch badges**

Add CSS classes:
```css
.dispatch-badge {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 10px;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
}
.badge-sent { background: rgba(34, 197, 94, 0.15); color: #22c55e; border: 1px solid rgba(34, 197, 94, 0.3); }
.badge-simulated { background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3); }
.badge-failed { background: rgba(239, 68, 68, 0.15); color: #ef4444; border: 1px solid rgba(239, 68, 68, 0.3); }
.badge-cooldown { background: rgba(148, 163, 184, 0.15); color: #94a3b8; border: 1px solid rgba(148, 163, 184, 0.3); }
.fallback-sms-btn { background: #f59e0b; color: #000; font-weight: 700; border-radius: 6px; padding: 6px 12px; }
```

- [ ] **Step 4: Manual browser verification via local dev test**

Run: `python3 app.py` and inspect `http://localhost:5000` to confirm:
- Section header says "Emergency SMS Broadcast Hub".
- Adding contact shows `✉️` (SMS) and `📞` (Call) icons.
- Pressing SOS renders the simulated SMS pill without opening a WhatsApp tab.

- [ ] **Step 5: Commit**

```bash
git add templates/index.html static/app.js static/style.css
git commit -m "feat(ui): update dashboard copy, pills, badges, and contact actions from WhatsApp to SMS"
```

---

### Task 4: Full Suite Test Verification & Documentation

**Files:**
- Modify: `tests/test_api.py`
- Modify: `README.md`

**Interfaces:**
- Consumes: All tests and documentation files.
- Produces: 100% passing test suite and clear Twilio configuration guide.

- [ ] **Step 1: Run complete test suite and fix any regressions**

Run: `pytest tests/test_api.py -v`  
Expected: All tests pass (including existing contact CRUD, coordinate checks, and new Twilio SMS tests).

- [ ] **Step 2: Update README with Twilio configuration instructions**

Add section to `README.md`:
```markdown
### Twilio Cellular SMS Integration
KAVACH automatically broadcasts emergency distress SMS to all trusted contacts when SOS triggers.

Configure the following environment variables in `.env` or on Vercel:
```bash
TWILIO_ACCOUNT_SID=ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token_here
TWILIO_PHONE_NUMBER=+12055550199
TWILIO_DEFAULT_COUNTRY=+91
```
*Note: If Twilio credentials are unset, KAVACH runs safely in Simulation Mode without crashing.*
```

- [ ] **Step 3: Run git status and verify clean working tree**

Run: `git status`  
Expected: Clean working tree on branch `main`.

- [ ] **Step 4: Commit**

```bash
git add tests/test_api.py README.md
git commit -m "docs: add Twilio setup instructions and finalize SMS dispatch test coverage"
```
