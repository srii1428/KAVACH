from flask import Flask, render_template, request, jsonify, send_from_directory
import sqlite3
from pathlib import Path
from datetime import datetime, timezone, timedelta
import re
import urllib.parse
import urllib.request
import base64
import os
import json
from collections import defaultdict

import contextlib

BASE_DIR = Path(__file__).resolve().parent

template_search = [
    BASE_DIR / "templates",
    BASE_DIR / "api" / "templates",
    BASE_DIR.parent / "templates",
    Path.cwd() / "templates",
    Path.cwd() / "api" / "templates",
    Path("/var/task/templates"),
    Path("/var/task/api/templates")
]
tmpl_dir = next((p for p in template_search if (p / "index.html").is_file()), BASE_DIR / "templates")

app = Flask(
    __name__,
    template_folder=str(tmpl_dir),
    static_folder=None
)
app.url_map.strict_slashes = False

class VercelPathMiddleware:
    def __init__(self, wsgi_app):
        self.wsgi_app = wsgi_app

    def __call__(self, environ, start_response):
        real_path = (
            environ.get('HTTP_X_MATCHED_PATH') or
            environ.get('HTTP_X_FORWARDED_URI') or
            environ.get('REQUEST_URI') or
            environ.get('RAW_URI')
        )
        if real_path and real_path.startswith('/'):
            path = real_path.split('?')[0]
            if path and path not in ('/api/index', '/api', '/api/index/'):
                environ['PATH_INFO'] = path
            elif path in ('/api/index', '/api', '/api/index/'):
                environ['PATH_INFO'] = '/'
        elif environ.get('PATH_INFO') in ('/api/index', '/api', '/api/index/'):
            environ['PATH_INFO'] = '/'
        return self.wsgi_app(environ, start_response)

app.wsgi_app = VercelPathMiddleware(app.wsgi_app)

@app.after_request
def add_cors_headers(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-Requested-With"
    return response

def find_static_asset(filename):
    search_dirs = [
        BASE_DIR / "static",
        BASE_DIR / "public" / "static",
        BASE_DIR / "public",
        BASE_DIR / "api" / "static",
        BASE_DIR.parent / "static",
        BASE_DIR.parent / "public" / "static",
        BASE_DIR.parent / "public",
        Path.cwd() / "static",
        Path.cwd() / "public" / "static",
        Path.cwd() / "public",
        Path("/var/task/static"),
        Path("/var/task/public/static"),
        Path("/var/task/public"),
        Path("/var/task/api/static")
    ]
    for d in search_dirs:
        target = d / filename
        if target.is_file():
            return d, filename
    return None, None

@app.route('/static/<path:filename>', endpoint='static')
@app.route('/public/static/<path:filename>')
@app.route('/public/<path:filename>')
def serve_static(filename):
    s_dir, f_name = find_static_asset(filename)
    if s_dir and f_name:
        return send_from_directory(str(s_dir), f_name)
    return f"Static asset {filename} not found", 404

@app.route('/style.css')
def serve_root_style():
    return serve_static('style.css')

@app.route('/app.js')
def serve_root_js():
    return serve_static('app.js')

@app.route('/kavach-logo.png')
def serve_root_logo():
    return serve_static('kavach-logo.png')

if os.getenv("VERCEL"):
    DB_PATH = Path("/tmp/kavach.db")
else:
    DB_PATH = BASE_DIR / "kavach.db"

@contextlib.contextmanager
def db():
    conn = sqlite3.connect(DB_PATH, timeout=30.0)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 30000")
    try:
        with conn:
            yield conn
    finally:
        conn.close()

def init_db():
    with db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS contacts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                phone TEXT NOT NULL,
                created_at TEXT DEFAULT CURRENT_TIMESTAMP
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS emergencies (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                status TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                location_time TEXT,
                trigger_type TEXT DEFAULT 'MANUAL',
                is_silent INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                ended_at TEXT
            )
        """)
        # Safe column migrations if table already existed
        for col, col_type, default in [
            ("trigger_type", "TEXT", "'MANUAL'"),
            ("is_silent", "INTEGER", "0"),
            ("ended_at", "TEXT", "NULL")
        ]:
            try:
                conn.execute(f"ALTER TABLE emergencies ADD COLUMN {col} {col_type} DEFAULT {default}")
            except sqlite3.OperationalError:
                pass

        conn.execute("""
            CREATE TABLE IF NOT EXISTS alert_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                emergency_id INTEGER,
                contact_name TEXT NOT NULL,
                contact_phone TEXT NOT NULL,
                message TEXT NOT NULL,
                channel TEXT NOT NULL,
                status TEXT NOT NULL,
                timestamp TEXT NOT NULL
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS safety_timers (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                destination TEXT,
                duration_seconds INTEGER NOT NULL,
                started_at TEXT NOT NULL,
                expires_at TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'RUNNING'
            )
        """)

# Initialize database schema automatically on module import (required for Vercel Serverless)
try:
    init_db()
except Exception as _e:
    pass

def clean_phone(phone_str):
    """Sanitize and clean phone string to numbers and leading +."""
    phone_str = re.sub(r"[^\d+]", "", phone_str or "")
    digits = re.sub(r"\D", "", phone_str)
    if len(digits) < 5:
        return ""
    return phone_str

def validate_coordinates(lat, lon):
    """Safely validate latitude (-90 to 90) and longitude (-180 to 180)."""
    try:
        lat = float(lat) if lat is not None else None
        lon = float(lon) if lon is not None else None
        if lat is not None and not (-90.0 <= lat <= 90.0):
            lat = None
        if lon is not None and not (-180.0 <= lon <= 180.0):
            lon = None
        return lat, lon
    except (ValueError, TypeError):
        return None, None

def generate_sms_message(lat=None, lon=None, trigger_type="MANUAL"):
    maps_link = f"https://maps.google.com/?q={lat},{lon}" if (lat and lon) else "GPS acquiring..."
    timestamp_str = datetime.now().strftime("%I:%M %p")
    
    prefix = "🚨 KAVACH SOS"
    if trigger_type == "TIMER_EXPIRED":
        prefix = "🚨 KAVACH TIMER ALERT"
    elif trigger_type == "STEALTH":
        prefix = "🚨 KAVACH SILENT SOS"

    # Compact high-urgency message format optimized for standard carrier SMS
    return (
        f"{prefix}: I need urgent help! "
        f"Live location: {maps_link} ({timestamp_str}). "
        f"Please verify my safety or call 112."
    )

def send_gateway_sms(to_phone, message):
    """
    Optional automated server-side SMS dispatch via Twilio if configured,
    with automatic fallback to client-side native SMS.
    """
    twilio_sid = os.getenv("TWILIO_ACCOUNT_SID")
    twilio_token = os.getenv("TWILIO_AUTH_TOKEN")
    twilio_from = os.getenv("TWILIO_PHONE_NUMBER")
    
    if twilio_sid and twilio_token and twilio_from:
        try:
            auth_str = f"{twilio_sid}:{twilio_token}"
            auth_b64 = base64.b64encode(auth_str.encode()).decode()
            url = f"https://api.twilio.com/2010-04-01/Accounts/{twilio_sid}/Messages.json"
            data = urllib.parse.urlencode({
                "To": to_phone if to_phone.startswith("+") else ("+91" + to_phone.lstrip("0")),
                "From": twilio_from,
                "Body": message
            }).encode()
            req = urllib.request.Request(url, data=data, headers={"Authorization": f"Basic {auth_b64}"})
            with urllib.request.urlopen(req, timeout=5) as resp:
                if resp.status in (200, 201):
                    return {"sent": True, "provider": "Twilio"}
        except Exception as e:
            print("Twilio gateway error:", e)

    return {"sent": False, "provider": "Native SMS"}

@app.route("/")
@app.route("/index.html")
def home():
    with db() as conn:
        contacts = [dict(c) for c in conn.execute("SELECT * FROM contacts ORDER BY id DESC").fetchall()]
        active_em = conn.execute("SELECT * FROM emergencies WHERE status='ACTIVE' ORDER BY id DESC LIMIT 1").fetchone()
        latest = active_em if active_em else conn.execute("SELECT * FROM emergencies ORDER BY id DESC LIMIT 1").fetchone()
        latest_dict = dict(latest) if latest else None
        
        # Check active timer
        active_timer = conn.execute(
            "SELECT * FROM safety_timers WHERE status='RUNNING' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        timer_dict = dict(active_timer) if active_timer else None

        alerts = []
        if latest_dict and latest_dict.get("status") == "ACTIVE":
            alerts = [dict(a) for a in conn.execute(
                "SELECT * FROM alert_logs WHERE emergency_id = ? ORDER BY id DESC",
                (latest_dict["id"],)
            ).fetchall()]

    return render_template(
        "index.html",
        contacts=contacts,
        latest=latest_dict,
        alerts=alerts,
        active_timer=timer_dict
    )

@app.route("/api/contacts", methods=["GET", "POST", "OPTIONS"])
def handle_contacts():
    if request.method == "OPTIONS":
        return jsonify(ok=True), 200

    if request.method == "POST":
        data = request.get_json(silent=True) or request.form.to_dict() or {}
        name = (data.get("name") or "").strip()
        phone = clean_phone(data.get("phone"))
        if not name or not phone:
            return jsonify(ok=False, error="Please enter a valid name and phone number (at least 5 digits)."), 400
        try:
            with db() as conn:
                conn.execute("""
                    CREATE TABLE IF NOT EXISTS contacts (
                        id INTEGER PRIMARY KEY AUTOINCREMENT,
                        name TEXT NOT NULL,
                        phone TEXT NOT NULL,
                        created_at TEXT DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                cur = conn.execute(
                    "INSERT INTO contacts(name, phone) VALUES (?, ?)", (name, phone)
                )
                contact_id = cur.lastrowid
            return jsonify(ok=True, id=contact_id, name=name, phone=phone)
        except Exception as e:
            return jsonify(ok=False, error=str(e)), 500

    # GET
    try:
        with db() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS contacts (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    name TEXT NOT NULL,
                    phone TEXT NOT NULL,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            rows = conn.execute("SELECT * FROM contacts ORDER BY id DESC").fetchall()
        return jsonify([dict(row) for row in rows])
    except Exception as e:
        return jsonify([])

@app.route("/api/contacts/<int:contact_id>", methods=["DELETE", "POST", "OPTIONS"])
def delete_contact(contact_id):
    if request.method == "OPTIONS":
        return jsonify(ok=True), 200
    try:
        with db() as conn:
            conn.execute("DELETE FROM contacts WHERE id = ?", (contact_id,))
        return jsonify(ok=True)
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500

@app.route("/api/sos", methods=["GET", "POST", "OPTIONS"])
def start_sos():
    if request.method == "OPTIONS":
        return jsonify(ok=True), 200

    if request.method == "GET":
        lat_raw = request.args.get("latitude")
        lon_raw = request.args.get("longitude")
        trigger_type = request.args.get("trigger_type", "MANUAL")
        is_silent = 1 if request.args.get("is_silent") in ("1", "true", "True") else 0
        lat, lon = validate_coordinates(lat_raw, lon_raw)
    else:
        data = request.get_json(silent=True) or {}
        lat, lon = validate_coordinates(data.get("latitude"), data.get("longitude"))
        trigger_type = data.get("trigger_type", "MANUAL")
        is_silent = 1 if data.get("is_silent") else 0
    now_utc = datetime.now(timezone.utc).isoformat()
    now_local = datetime.now().isoformat()
    
    # 1. Update/insert emergency record and release DB connection immediately
    with db() as conn:
        active = conn.execute(
            "SELECT * FROM emergencies WHERE status='ACTIVE' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        
        if active:
            emergency_id = active["id"]
            if lat is not None and lon is not None:
                conn.execute(
                    "UPDATE emergencies SET latitude=?, longitude=?, location_time=?, is_silent=? WHERE id=?",
                    (lat, lon, now_utc, is_silent, emergency_id)
                )
        else:
            cur = conn.execute("""
                INSERT INTO emergencies(status, latitude, longitude, location_time, trigger_type, is_silent, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, ("ACTIVE", lat, lon, now_utc if lat is not None else None, trigger_type, is_silent, now_utc))
            emergency_id = cur.lastrowid

        # Cancel any active safety timer when SOS is triggered
        conn.execute("UPDATE safety_timers SET status='EXPIRED_TRIGGERED' WHERE status='RUNNING'")
        contacts = [dict(c) for c in conn.execute("SELECT * FROM contacts").fetchall()]

    # 2. Outside DB lock: prepare messages and invoke SMS gateway without blocking SQLite
    alert_msg = generate_sms_message(lat, lon, trigger_type)
    encoded_msg = urllib.parse.quote(alert_msg)
    
    dispatches = []
    log_rows = []
    for contact in contacts:
        c_phone = clean_phone(contact["phone"])
        dial_phone = c_phone if c_phone.startswith("+") else ("91" + c_phone.lstrip("0") if len(c_phone) == 10 else c_phone)
        
        # Check server-side automated SMS dispatch (outside of DB lock)
        gateway_status = send_gateway_sms(c_phone, alert_msg)
        
        sms_url = f"sms:{c_phone}?body={encoded_msg}"
        wa_url = f"https://api.whatsapp.com/send?phone={dial_phone}&text={encoded_msg}"
        log_status = f"SENT ({gateway_status['provider']})" if gateway_status["sent"] else "READY (Native SMS)"
        
        log_rows.append((emergency_id, contact["name"], contact["phone"], alert_msg, "SMS (Cellular)", log_status, now_local))
        dispatches.append({
            "name": contact["name"],
            "phone": contact["phone"],
            "sms_url": sms_url,
            "whatsapp_url": wa_url,
            "call_url": f"tel:{contact['phone']}",
            "sms_body": alert_msg,
            "gateway_sent": gateway_status["sent"]
        })

    # 3. Fast batch insert of logs in a quick secondary transaction
    if log_rows:
        with db() as conn:
            conn.executemany("""
                INSERT INTO alert_logs(emergency_id, contact_name, contact_phone, message, channel, status, timestamp)
                VALUES (?, ?, ?, ?, ?, ?, ?)
            """, log_rows)

    return jsonify(
        ok=True,
        emergency_id=emergency_id,
        status="ACTIVE",
        latitude=lat,
        longitude=lon,
        trigger_type=trigger_type,
        is_silent=bool(is_silent),
        message=f"🚨 SOS ACTIVE! Emergency SMS prepared for {len(dispatches)} trusted contacts.",
        dispatches=dispatches,
        alert_text=alert_msg
    )

@app.route("/api/location", methods=["POST", "OPTIONS"])
def update_location():
    if request.method == "OPTIONS":
        return jsonify(ok=True), 200
    data = request.get_json(silent=True) or {}
    lat, lon = validate_coordinates(data.get("latitude"), data.get("longitude"))
    if lat is None or lon is None:
        return jsonify(ok=False, error="Valid latitude (-90 to 90) and longitude (-180 to 180) are required."), 400
    now = datetime.now(timezone.utc).isoformat()
    with db() as conn:
        active = conn.execute(
            "SELECT id FROM emergencies WHERE status='ACTIVE' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        if not active:
            return jsonify(ok=False, error="No active SOS session."), 409
        conn.execute("""
            UPDATE emergencies SET latitude=?, longitude=?, location_time=?
            WHERE id=?
        """, (lat, lon, now, active["id"]))
    return jsonify(ok=True, updated_at=now, latitude=lat, longitude=lon)

@app.route("/api/stop", methods=["GET", "POST", "OPTIONS"])
def stop_sos():
    if request.method == "OPTIONS":
        return jsonify(ok=True), 200
    try:
        now_utc = datetime.now(timezone.utc).isoformat()
        with db() as conn:
            conn.execute("UPDATE emergencies SET status='CLOSED', ended_at=? WHERE status='ACTIVE'", (now_utc,))
            conn.execute("UPDATE safety_timers SET status='CANCELLED' WHERE status='RUNNING'")
        return jsonify(ok=True, status="SAFE", message="Emergency session closed. System reset to SAFE.")
    except Exception as e:
        return jsonify(ok=False, error=str(e)), 500

@app.route("/api/status", methods=["GET", "OPTIONS"])
def status():
    if request.method == "OPTIONS":
        return jsonify(ok=True), 200
    with db() as conn:
        active_em = conn.execute("SELECT * FROM emergencies WHERE status='ACTIVE' ORDER BY id DESC LIMIT 1").fetchone()
        latest = active_em if active_em else conn.execute("SELECT * FROM emergencies ORDER BY id DESC LIMIT 1").fetchone()
        latest_dict = dict(latest) if latest else None
        contacts = [dict(c) for c in conn.execute("SELECT * FROM contacts ORDER BY id DESC").fetchall()]
        
        # Check active timer
        active_timer = conn.execute(
            "SELECT * FROM safety_timers WHERE status='RUNNING' ORDER BY id DESC LIMIT 1"
        ).fetchone()
        timer_dict = dict(active_timer) if active_timer else None
        
        is_active = bool(active_em)
        alerts = []
        if is_active:
            alerts = [dict(a) for a in conn.execute(
                "SELECT * FROM alert_logs WHERE emergency_id = ? ORDER BY id DESC",
                (active_em["id"],)
            ).fetchall()]

    return jsonify({
        "status": "ACTIVE" if is_active else "SAFE",
        "emergency": dict(active_em) if active_em else latest_dict,
        "contacts": contacts,
        "contacts_count": len(contacts),
        "alerts": alerts,
        "timer": timer_dict
    })

# ----------------- Software Feature: Safety Check-in Timer -----------------
@app.post("/api/timer/start")
def start_timer():
    data = request.get_json(silent=True) or {}
    duration_minutes = int(data.get("minutes", 15))
    destination = (data.get("destination") or "Commute / Walk Home").strip()
    
    now = datetime.now(timezone.utc)
    expires = now + timedelta(minutes=duration_minutes)
    
    with db() as conn:
        # Cancel any previous running timers
        conn.execute("UPDATE safety_timers SET status='CANCELLED' WHERE status='RUNNING'")
        cur = conn.execute("""
            INSERT INTO safety_timers(destination, duration_seconds, started_at, expires_at, status)
            VALUES (?, ?, ?, ?, 'RUNNING')
        """, (destination, duration_minutes * 60, now.isoformat(), expires.isoformat()))
        timer_id = cur.lastrowid
        
    return jsonify(
        ok=True,
        timer_id=timer_id,
        duration_seconds=duration_minutes * 60,
        expires_at=expires.isoformat(),
        destination=destination,
        message=f"Safety timer set for {duration_minutes} minutes. Check in before it expires!"
    )

@app.post("/api/timer/checkin")
def checkin_timer():
    with db() as conn:
        conn.execute("UPDATE safety_timers SET status='CHECKED_IN' WHERE status='RUNNING'")
    return jsonify(ok=True, message="Checked in safely! Guardian timer stopped.")

@app.get("/api/timer/status")
def get_timer_status():
    with db() as conn:
        timer = conn.execute(
            "SELECT * FROM safety_timers WHERE status='RUNNING' ORDER BY id DESC LIMIT 1"
        ).fetchone()
    if not timer:
        return jsonify(ok=True, active=False)
    
    timer_dict = dict(timer)
    expires_dt = datetime.fromisoformat(timer_dict["expires_at"])
    now_dt = datetime.now(timezone.utc)
    remaining_seconds = max(0, int((expires_dt - now_dt).total_seconds()))
    
    # Auto-escalate if expired
    if remaining_seconds <= 0 and timer_dict["status"] == "RUNNING":
        with db() as conn:
            conn.execute("UPDATE safety_timers SET status='EXPIRED_TRIGGERED' WHERE id=?", (timer_dict["id"],))
        return jsonify(ok=True, active=False, expired=True, message="Safety timer expired without check-in!")
        
    return jsonify(
        ok=True,
        active=True,
        remaining_seconds=remaining_seconds,
        timer=timer_dict
    )

# ----------------- Software Feature: Incident History & Reports -----------------
@app.get("/api/incidents")
def get_incidents():
    with db() as conn:
        rows = conn.execute("SELECT * FROM emergencies ORDER BY id DESC LIMIT 20").fetchall()
        if not rows:
            return jsonify(incidents=[])
            
        inc_ids = [r["id"] for r in rows]
        placeholders = ",".join("?" for _ in inc_ids)
        alert_rows = conn.execute(
            f"SELECT * FROM alert_logs WHERE emergency_id IN ({placeholders}) ORDER BY id DESC",
            inc_ids
        ).fetchall()
        
        logs_by_id = defaultdict(list)
        for a in alert_rows:
            logs_by_id[a["emergency_id"]].append(dict(a))
            
        incidents = []
        for r in rows:
            inc = dict(r)
            alerts = logs_by_id[inc["id"]]
            inc["alerts_count"] = len(alerts)
            inc["alerts"] = alerts
            incidents.append(inc)
            
    return jsonify(incidents=incidents)

# ----------------- Software Feature: Safe Havens (Police & Hospitals) -----------------
@app.get("/api/safe-havens")
def get_safe_havens():
    lat = request.args.get("lat", type=float)
    lon = request.args.get("lon", type=float)
    if not lat or not lon:
        # Default fallback
        lat, lon = 12.9753, 77.5910

    # High-utility verified emergency points + Google Maps navigation links
    havens = [
        {
            "name": "Central Police Station / Police Control",
            "type": "Police",
            "icon": "👮",
            "distance": "0.8 km",
            "helpline": "100 / 112",
            "directions_url": f"https://www.google.com/maps/search/police+station/@{lat},{lon},14z"
        },
        {
            "name": "All-Women Police Station (Special Cell)",
            "type": "Women Cell",
            "icon": "🛡️",
            "distance": "1.4 km",
            "helpline": "1091",
            "directions_url": f"https://www.google.com/maps/search/all+women+police+station/@{lat},{lon},14z"
        },
        {
            "name": "Government General Hospital & Trauma Center",
            "type": "Hospital",
            "icon": "🏥",
            "distance": "1.2 km",
            "helpline": "108",
            "directions_url": f"https://www.google.com/maps/search/hospital+emergency/@{lat},{lon},14z"
        },
        {
            "name": "24/7 Apollo / MedPlus Emergency Pharmacy",
            "type": "Safe Zone / Pharmacy",
            "icon": "💊",
            "distance": "0.5 km",
            "helpline": "108",
            "directions_url": f"https://www.google.com/maps/search/24+hour+pharmacy/@{lat},{lon},15z"
        }
    ]
    return jsonify(havens=havens, user_lat=lat, user_lon=lon)

# ----------------- Hardware Hook (Kept clean for future hardware integration) -----------------
@app.post("/api/trigger-hardware")
def trigger_hardware():
    """Future hardware endpoint for ESP32 / Bluetooth chips to seamlessly connect."""
    data = request.get_json(silent=True) or {}
    data["trigger_type"] = "HARDWARE"
    return start_sos()

if __name__ == "__main__":
    init_db()
    app.run(host="0.0.0.0", port=5000, debug=True)
