# Supabase Auth & Cloud-Synced Contacts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate Supabase Authentication and Supabase PostgreSQL with Row-Level Security for user accounts and cloud-synced contacts while maintaining instant guest panic SOS access.

**Architecture:** Client-side Supabase JS SDK handles authentication and direct PostgreSQL operations via Row-Level Security (RLS). Flask backend provides public environment configuration, serves templates/assets, and accepts active contacts directly in `/api/sos` for 0ms dispatch latency. Active contacts are cached in localStorage for immediate offline and crisis availability.

**Tech Stack:** Python Flask, HTML5/CSS3 (Vanilla), JavaScript (ES6+), Supabase Auth & PostgreSQL (Supabase JS v2 CDN), SQLite (local dev fallback).

**Spec:** `docs/superpowers/specs/2026-11-19-supabase-auth-and-contacts-design.md`

## Global Constraints
- Panic SOS, siren, live GPS tracking, and national helplines must NEVER be gated or disabled behind an auth check.
- All Supabase tables must enable Row-Level Security (RLS) enforcing `user_id = auth.uid()`.
- The client must never expose the Supabase `service_role` key; only the public `anon` key is permitted on the client.
- When an SOS is triggered, the client must use locally cached contacts if network latency or auth errors occur, guaranteeing 100% life-safety availability.

## Review Focus
- Unauthenticated guest user triggering SOS: must succeed immediately using local contacts and national helplines with zero login prompts.
- Expired session token mid-transit: must not block emergency SOS or contact dispatches; cached contacts are used seamlessly.
- Cross-user data isolation: user A must never be able to select, update, or delete user B's contacts or incident logs.
- Network dropout during crisis: cached contacts in localStorage must populate WhatsApp dispatches and telephone dialers without network round-trips.
- User adds contacts as guest, then registers: contacts stored locally should automatically sync to their new Supabase account.

---

### Task 1: Supabase Configuration & Backend Config Endpoint

**Files:**
- Modify: `app.py`
- Modify: `tests/test_api.py`

**Interfaces:**
- Consumes: `os.getenv("SUPABASE_URL")`, `os.getenv("SUPABASE_ANON_KEY")`
- Produces: `GET /api/config` returning JSON `{ "supabase_url": str, "supabase_anon_key": str }`

- [ ] **Step 1: Write failing test in `tests/test_api.py`**

```python
def test_config_endpoint(self):
    resp = self.client.get("/api/config")
    self.assertEqual(resp.status_code, 200)
    data = resp.get_json()
    self.assertIn("supabase_url", data)
    self.assertIn("supabase_anon_key", data)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/naveen/Downloads/KAVACH && .venv/bin/python3 -m unittest tests.test_api.KavachApiTestCase.test_config_endpoint`  
Expected: FAIL with 404 Not Found

- [ ] **Step 3: Implement `/api/config` endpoint in `app.py`**

```python
@app.route("/api/config", methods=["GET", "OPTIONS"])
def get_config():
    if request.method == "OPTIONS":
        return jsonify(ok=True), 200
    return jsonify({
        "supabase_url": os.getenv("SUPABASE_URL", ""),
        "supabase_anon_key": os.getenv("SUPABASE_ANON_KEY", "")
    })
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/naveen/Downloads/KAVACH && .venv/bin/python3 -m unittest tests.test_api.KavachApiTestCase.test_config_endpoint`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_api.py
git commit -m "feat(config): add /api/config endpoint for safe client Supabase credentials"
```

---

### Task 2: Supabase Database Schema Migration Script

**Files:**
- Create: `migrations/001_create_contacts_and_incidents.sql`
- Create: `tests/test_migration_syntax.py`

**Interfaces:**
- Consumes: PostgreSQL / Supabase SQL dialect
- Produces: Executable migration for Supabase Dashboard SQL Editor creating `public.contacts` and `public.incidents` with RLS.

- [ ] **Step 1: Write test verifying SQL syntax and policy definitions**

```python
# tests/test_migration_syntax.py
import unittest
from pathlib import Path

class MigrationSyntaxTestCase(unittest.TestCase):
    def test_migration_file_exists_and_contains_rls(self):
        sql_path = Path("migrations/001_create_contacts_and_incidents.sql")
        self.assertTrue(sql_path.exists())
        sql = sql_path.read_text()
        self.assertIn("create table if not exists public.contacts", sql)
        self.assertIn("alter table public.contacts enable row level security", sql)
        self.assertIn("auth.uid() = user_id", sql)
        self.assertIn("create table if not exists public.incidents", sql)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/naveen/Downloads/KAVACH && .venv/bin/python3 -m unittest tests/test_migration_syntax.py`  
Expected: FAIL with FileNotFoundError

- [ ] **Step 3: Create `migrations/001_create_contacts_and_incidents.sql`**

Write standard Supabase PostgreSQL tables `public.contacts` and `public.incidents` with `enable row level security` and policies for select, insert, and delete using `auth.uid() = user_id`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/naveen/Downloads/KAVACH && .venv/bin/python3 -m unittest tests/test_migration_syntax.py`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add migrations/ tests/test_migration_syntax.py
git commit -m "feat(db): add Supabase PostgreSQL migration script with RLS policies"
```

---

### Task 3: Backend `/api/sos` Payload Update for Client-Supplied Contacts

**Files:**
- Modify: `app.py`
- Modify: `tests/test_api.py`

**Interfaces:**
- Consumes: `POST /api/sos` body field `contacts: Optional[List[Dict[str, str]]]`
- Produces: Fast emergency WhatsApp and SMS dispatches using client-provided contacts with local DB query fallback.

- [ ] **Step 1: Write failing test in `tests/test_api.py`**

```python
def test_sos_with_client_supplied_contacts(self):
    client_contacts = [
        {"name": "Direct Test Contact", "phone": "9876543210"}
    ]
    resp = self.client.post("/api/sos", json={
        "latitude": 12.9716,
        "longitude": 77.5946,
        "contacts": client_contacts
    })
    self.assertEqual(resp.status_code, 200)
    data = resp.get_json()
    self.assertEqual(len(data["dispatches"]), 1)
    self.assertEqual(data["dispatches"][0]["name"], "Direct Test Contact")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/naveen/Downloads/KAVACH && .venv/bin/python3 -m unittest tests.test_api.KavachApiTestCase.test_sos_with_client_supplied_contacts`  
Expected: FAIL (contacts list ignores client payload)

- [ ] **Step 3: Update `start_sos()` in `app.py`**

In `start_sos()`, inspect `data.get("contacts")`. If present and non-empty, use `client_contacts = data["contacts"]`. If empty or absent, fall back to SQLite `SELECT * FROM contacts`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/naveen/Downloads/KAVACH && .venv/bin/python3 -m unittest tests.test_api.KavachApiTestCase.test_sos_with_client_supplied_contacts`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add app.py tests/test_api.py
git commit -m "feat(sos): allow client-supplied contacts in /api/sos for 0ms emergency dispatch"
```

---

### Task 4: UI Auth Modal & Supabase Client Initialization

**Files:**
- Modify: `templates/index.html`
- Modify: `static/style.css`
- Modify: `static/app.js`

**Interfaces:**
- Consumes: `@supabase/supabase-js` v2 CDN, `/api/config`
- Produces: Header Sign In / Profile action, Auth Modal (Sign In / Sign Up tabs), Supabase client singleton `window.supabaseClient`.

- [ ] **Step 1: Add Supabase CDN and Auth Modal markup to `templates/index.html`**

Add `<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>` to `<head>`.  
In `<header class="topbar">`, add `<div id="authActions" class="auth-actions"><button id="openAuthModalBtn" class="auth-btn">🔑 Sign In</button></div>`.  
Add accessible Auth Modal `#authModal` with Email/Password inputs, `Sign In` / `Sign Up` tabs, and error container `#authError`.

- [ ] **Step 2: Add Auth Modal styles to `static/style.css` and embedded styles**

Add modal overlay, backdrop blur, card container, tab switchers, input styling, and status pills matching the KAVACH design system.

- [ ] **Step 3: Implement Supabase Client & Auth Handlers in `static/app.js`**

Fetch `/api/config`. If configured, initialize `window.supabaseClient = supabase.createClient(url, anonKey)`.  
Attach modal open/close listeners.  
Implement `signUpUser(email, password)`, `signInUser(email, password)`, and `signOutUser()`.  
Attach `supabase.auth.onAuthStateChange(handleAuthStateChange)`.

- [ ] **Step 4: Verify Auth UI via browser/headless test or manual check**

Run: `cd /home/naveen/Downloads/KAVACH && .venv/bin/python3 -m unittest discover tests`  
Verify syntax and page loading returns 200 OK with Auth Modal markup.

- [ ] **Step 5: Commit**

```bash
git add templates/index.html static/style.css static/app.js
git commit -m "feat(auth): add Supabase client initialization, header auth trigger, and auth modal"
```

---

### Task 5: Cloud Contacts CRUD with RLS & Local Emergency Caching

**Files:**
- Modify: `static/app.js`
- Modify: `templates/index.html`

**Interfaces:**
- Consumes: `window.supabaseClient`, `localStorage` key `kavach_trusted_contacts`
- Produces: Seamless contact list management syncing to Supabase PostgreSQL when authenticated, falling back to localStorage when guest.

- [ ] **Step 1: Implement Local Storage Contact Helper Functions in `static/app.js`**

Implement `getLocalContacts()`, `saveLocalContacts(list)`, and `getCachedContacts()`.

- [ ] **Step 2: Implement Cloud / Local Dual-Mode CRUD in `static/app.js`**

In `loadContacts()`:
- If authenticated: `const { data, error } = await supabaseClient.from('contacts').select('*').order('created_at', { ascending: false });`  
  Update `localStorage` cache with fetched contacts.
- If guest: load from `getLocalContacts()`.  
In `contactForm.addEventListener('submit')`:
- If authenticated: insert into Supabase `contacts` table (`{ name, phone }`).
- If guest: append to `localStorage` contacts.  
In delete contact:
- If authenticated: delete from Supabase table where `id = contactId`.
- If guest: filter from `localStorage`.

- [ ] **Step 3: Implement Automatic Guest-to-Cloud Sync upon Sign In**

In `handleAuthStateChange(event, session)`:
When `event === 'SIGNED_IN'`:
Check if any contacts exist in `localStorage`. If so, offer or automatically insert them into `supabaseClient.from('contacts')` under the new `user.id`.

- [ ] **Step 4: Update `triggerSOS()` in `static/app.js` to include cached contacts**

Ensure `triggerSOS()` attaches `contacts: getCachedContacts()` to the `/api/sos` request body, guaranteeing emergency dispatches are populated with 0ms latency.

- [ ] **Step 5: Commit**

```bash
git add static/app.js templates/index.html
git commit -m "feat(contacts): dual-mode Supabase cloud sync with emergency local storage caching"
```

---

### Task 6: Cloud Incident Reporting with RLS

**Files:**
- Modify: `static/app.js`
- Modify: `templates/index.html`

**Interfaces:**
- Consumes: `supabaseClient.from('incidents')`
- Produces: Cloud-synced incident log records with downloadable police reports.

- [ ] **Step 1: Add Supabase incident logging in `static/app.js`**

When an SOS is activated or stopped:
If authenticated, insert a record into `supabaseClient.from('incidents')` containing `{ status, latitude, longitude, trigger_type, summary }`.

- [ ] **Step 2: Render incident history from Supabase or localStorage**

In the "Incident Log" tab (`tab-history`), render previous incident records from Supabase if authenticated, or from local state if guest.

- [ ] **Step 3: Commit**

```bash
git add static/app.js templates/index.html
git commit -m "feat(incidents): sync incident logs to Supabase with local fallback"
```

---

### Task 7: Full System Verification, Worktree Sync & Release

**Files:**
- Modify: `app.py`
- Modify: `static/`
- Modify: `templates/`
- Modify: `KAVACH_Full_Software_Release/`

**Interfaces:**
- Consumes: All updated files
- Produces: Green test suite, clean local dev server, updated offline zip, and committed git release.

- [ ] **Step 1: Run complete automated test suite**

Run: `cd /home/naveen/Downloads/KAVACH && .venv/bin/python3 -m unittest discover tests`  
Expected: All tests pass (8/8 or higher).

- [ ] **Step 2: Synchronize files to `KAVACH_Full_Software_Release/KAVACH/`**

Mirror `app.py`, `static/`, `templates/`, `migrations/`, and `vercel.json` into `KAVACH_Full_Software_Release/KAVACH/`.

- [ ] **Step 3: Update offline zip archive**

Run Python script to re-package `/home/naveen/Downloads/KAVACH.zip`.

- [ ] **Step 4: Commit and push**

```bash
git add .
git commit -m "feat(release): complete Supabase Auth, Cloud Contacts, and Incident Sync"
git push origin main
```
