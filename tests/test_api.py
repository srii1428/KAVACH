import unittest
import json
import os
import tempfile
from pathlib import Path

# Set testing environment before importing app
os.environ["FLASK_ENV"] = "testing"

import app
from app import app as flask_app, init_db, clean_phone, validate_coordinates, generate_sms_message

class KavachApiTestCase(unittest.TestCase):
    def setUp(self):
        # Create a temporary database for test isolation
        self.db_fd, self.temp_db_path = tempfile.mkstemp(suffix=".db")
        app.DB_PATH = Path(self.temp_db_path)
        flask_app.config["TESTING"] = True
        self.client = flask_app.test_client()
        init_db()

    def tearDown(self):
        os.close(self.db_fd)
        if os.path.exists(self.temp_db_path):
            os.remove(self.temp_db_path)
        # Also clean up WAL and SHM files if created
        for ext in ["-shm", "-wal"]:
            wal_file = self.temp_db_path + ext
            if os.path.exists(wal_file):
                try:
                    os.remove(wal_file)
                except OSError:
                    pass

    def test_phone_sanitization_and_validation(self):
        self.assertEqual(clean_phone("+91 98765 43210"), "+919876543210")
        self.assertEqual(clean_phone("9876543210"), "9876543210")
        # Reject invalid short/empty phone numbers (less than 3 digits)
        self.assertEqual(clean_phone("+"), "")
        self.assertEqual(clean_phone("12"), "")
        self.assertEqual(clean_phone("abc"), "")
        self.assertEqual(clean_phone("112"), "112")

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
        # Add a contact
        self.client.post("/api/contacts", json={"name": "Guardian", "phone": "9876543210"})

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

    def test_coordinate_validation(self):
        lat, lon = validate_coordinates(12.9716, 77.5946)
        self.assertAlmostEqual(lat, 12.9716)
        self.assertAlmostEqual(lon, 77.5946)

        # Out-of-bound coordinates should return None
        lat, lon = validate_coordinates(95.0, 77.0)
        self.assertIsNone(lat)
        lat, lon = validate_coordinates(12.0, 190.0)
        self.assertIsNone(lon)

        # Invalid string inputs
        lat, lon = validate_coordinates("invalid", "coords")
        self.assertIsNone(lat)
        self.assertIsNone(lon)

    def test_contacts_crud(self):
        # 1. Add contact
        resp = self.client.post("/api/contacts", json={"name": "Priya Test", "phone": "9876543210"})
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["ok"])
        contact_id = data["id"]

        # 2. Add contact with invalid phone should fail (400)
        bad_resp = self.client.post("/api/contacts", json={"name": "Bad", "phone": "+"})
        self.assertEqual(bad_resp.status_code, 400)

        # 3. List contacts
        list_resp = self.client.get("/api/contacts")
        self.assertEqual(list_resp.status_code, 200)
        contacts = list_resp.get_json()
        self.assertEqual(len(contacts), 1)
        self.assertEqual(contacts[0]["name"], "Priya Test")

        # 4. Delete contact
        del_resp = self.client.delete(f"/api/contacts/{contact_id}")
        self.assertEqual(del_resp.status_code, 200)

        # Verify list is empty
        list_resp2 = self.client.get("/api/contacts")
        self.assertEqual(len(list_resp2.get_json()), 0)

    def test_sos_activation_and_disarm_lifecycle(self):
        # Add trusted contact first
        self.client.post("/api/contacts", json={"name": "Mom", "phone": "9876543210"})

        # 0. Test OPTIONS preflight request (CORS)
        opt_resp = self.client.open("/api/sos", method="OPTIONS")
        self.assertEqual(opt_resp.status_code, 200)

        # 1. Trigger SOS via POST
        sos_resp = self.client.post("/api/sos", json={
            "latitude": 12.9716,
            "longitude": 77.5946,
            "trigger_type": "MANUAL",
            "is_silent": False
        })
        self.assertEqual(sos_resp.status_code, 200)

        # 1b. Test GET /api/sos fallback also works with 200 OK
        get_sos_resp = self.client.get("/api/sos?latitude=12.9716&longitude=77.5946")
        self.assertEqual(get_sos_resp.status_code, 200)

        # 1c. Test Vercel rewritten route (hit /api/index with x-matched-path header)
        rewritten_sos = self.client.post("/api/index", headers={"x-matched-path": "/api/sos"}, json={
            "latitude": 12.9716,
            "longitude": 77.5946
        })
        self.assertEqual(rewritten_sos.status_code, 200)
        self.assertTrue(rewritten_sos.is_json)
        sos_data = sos_resp.get_json()
        self.assertTrue(sos_data["ok"])
        self.assertEqual(sos_data["status"], "ACTIVE")
        self.assertEqual(len(sos_data["dispatches"]), 1)
        self.assertIn("9876543210", sos_data["dispatches"][0]["sms_url"])
        self.assertIn("whatsapp.com", sos_data["dispatches"][0]["whatsapp_url"])

        # 2. Check /api/status returns ACTIVE
        status_resp = self.client.get("/api/status")
        status_data = status_resp.get_json()
        self.assertEqual(status_data["status"], "ACTIVE")

        # 3. Stream updated location
        loc_resp = self.client.post("/api/location", json={"latitude": 12.9750, "longitude": 77.5950})
        self.assertEqual(loc_resp.status_code, 200)

        # 4. Invalid location returns 400
        bad_loc = self.client.post("/api/location", json={"latitude": 999.0, "longitude": "abc"})
        self.assertEqual(bad_loc.status_code, 400)

        # 5. Stop SOS via POST
        stop_resp = self.client.post("/api/stop")
        self.assertEqual(stop_resp.status_code, 200)
        stop_data = stop_resp.get_json()
        self.assertEqual(stop_data["status"], "SAFE")

        # 6. Check /api/status returns SAFE
        status_resp2 = self.client.get("/api/status")
        self.assertEqual(status_resp2.get_json()["status"], "SAFE")

        # 7. Stop SOS via GET fallback also works
        stop_get_resp = self.client.get("/api/stop")
        self.assertEqual(stop_get_resp.status_code, 200)
        self.assertEqual(stop_get_resp.get_json()["status"], "SAFE")

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

    def test_guardian_safety_timer(self):
        # 1. Start timer
        start_resp = self.client.post("/api/timer/start", json={"minutes": 20, "destination": "Home Metro"})
        self.assertEqual(start_resp.status_code, 200)
        timer_data = start_resp.get_json()
        self.assertTrue(timer_data["ok"])
        self.assertEqual(timer_data["duration_seconds"], 1200)

        # 2. Get timer status
        status_resp = self.client.get("/api/timer/status")
        sdata = status_resp.get_json()
        self.assertTrue(sdata["active"])
        self.assertEqual(sdata["timer"]["destination"], "Home Metro")

        # 3. Check-in safe
        checkin_resp = self.client.post("/api/timer/checkin")
        self.assertEqual(checkin_resp.status_code, 200)

        # 4. Verify timer is now inactive
        status_resp2 = self.client.get("/api/timer/status")
        self.assertFalse(status_resp2.get_json()["active"])

    def test_incidents_api(self):
        # Trigger an emergency to populate data
        self.client.post("/api/sos", json={"latitude": 12.9716, "longitude": 77.5946})
        self.client.post("/api/stop")

        # Fetch incident history
        inc_resp = self.client.get("/api/incidents")
        self.assertEqual(inc_resp.status_code, 200)
        incidents = inc_resp.get_json().get("incidents", [])
        self.assertGreaterEqual(len(incidents), 1)
        self.assertEqual(incidents[0]["status"], "CLOSED")

    def test_config_endpoint(self):
        resp = self.client.get("/api/config")
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertIn("supabase_url", data)
        self.assertIn("supabase_anon_key", data)

    def test_static_assets_and_page_render(self):
        # 1. Test index page renders with embedded stylesheet across all aliases
        for path in ["/", "/api/index", "/index.html"]:
            resp = self.client.get(path)
            self.assertEqual(resp.status_code, 200, f"Failed on path {path}")
            self.assertIn("KAVACH", resp.get_data(as_text=True))
        index_resp = self.client.get("/")
        self.assertEqual(index_resp.status_code, 200)
        html = index_resp.get_data(as_text=True)
        self.assertIn("KAVACH", html)
        self.assertIn("Embedded KAVACH Critical Stylesheet", html)
        self.assertIn("kavach-brand-shield", html)
        self.assertIn("@supabase/supabase-js", html)
        self.assertIn("openAuthModalBtn", html)
        self.assertIn("authModal", html)

        # 2. Test static assets resolve with 200 OK and proper content types
        css_resp = self.client.get("/static/style.css")
        self.assertEqual(css_resp.status_code, 200)
        self.assertIn("text/css", css_resp.content_type)
        self.assertGreater(len(css_resp.data), 1000)

        js_resp = self.client.get("/static/app.js")
        self.assertEqual(js_resp.status_code, 200)
        self.assertIn("javascript", js_resp.content_type)
        self.assertGreater(len(js_resp.data), 1000)

        logo_resp = self.client.get("/static/kavach-logo.png")
        self.assertEqual(logo_resp.status_code, 200)
        self.assertEqual(logo_resp.content_type, "image/png")
        self.assertGreater(len(logo_resp.data), 1000)

        # 3. Test root aliases
        root_css = self.client.get("/style.css")
        self.assertEqual(root_css.status_code, 200)
        root_js = self.client.get("/app.js")
        self.assertEqual(root_js.status_code, 200)

    def test_sos_shortcode_helpline_bypasses_twilio(self):
        # Trigger SOS with shortcode 112
        res = self.client.post("/api/sos", json={
            "latitude": 12.9716,
            "longitude": 77.5946,
            "contacts": [{"name": "Emergency Police", "phone": "112"}]
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(len(data["dispatches"]), 1)
        dispatch = data["dispatches"][0]
        self.assertEqual(dispatch["channel"], "CALL")
        self.assertEqual(dispatch["status"], "helpline_speed_dial")
        self.assertEqual(dispatch["contact_phone"], "112")
        self.assertEqual(dispatch["call_url"], "tel:112")

    def test_send_twilio_sms_error_handling(self):
        # Test simulated network error
        import unittest.mock as mock
        import urllib.error
        with mock.patch("urllib.request.urlopen") as mock_urlopen:
            mock_urlopen.side_effect = urllib.error.URLError("Network unreachable")
            with mock.patch.dict(os.environ, {
                "TWILIO_ACCOUNT_SID": "test_dummy_twilio_sid",
                "TWILIO_AUTH_TOKEN": "secret_token",
                "TWILIO_PHONE_NUMBER": "+12055550199"
            }):
                res = app.send_twilio_sms("+919876543210", "Test Emergency Alert")
                self.assertFalse(res["ok"])
                self.assertEqual(res["status"], "failed")
                self.assertIn("Network unreachable", res["error"])

    def test_add_helpline_contact_succeeds(self):
        resp = self.client.post("/api/contacts", json={"name": "Police Helpline", "phone": "112"})
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()
        self.assertTrue(data["ok"])
        self.assertEqual(data["phone"], "112")

    def test_twilio_default_country_env_var(self):
        import unittest.mock as mock
        with mock.patch.dict(os.environ, {"TWILIO_DEFAULT_COUNTRY": "+1"}):
            res = app.normalize_and_route_contact("5551234567")
            self.assertEqual(res["route"], "CELLULAR")
            self.assertEqual(res["phone"], "+15551234567")

    def test_initial_gps_fix_triggers_location_dispatch(self):
        # 1. Add contact
        self.client.post("/api/contacts", json={"name": "Family", "phone": "9876543210"})
        # 2. Trigger SOS with no coordinates (GPS acquiring)
        sos_res = self.client.post("/api/sos", json={})
        self.assertEqual(sos_res.status_code, 200)
        # 3. Stream first GPS location fix
        loc_res = self.client.post("/api/location", json={"latitude": 12.9716, "longitude": 77.5946})
        self.assertEqual(loc_res.status_code, 200)
        loc_data = loc_res.get_json()
        self.assertTrue(loc_data["ok"])
        self.assertIn("dispatches", loc_data)
        self.assertEqual(len(loc_data["dispatches"]), 1)
        self.assertEqual(loc_data["dispatches"][0]["status"], "simulated")
        self.assertIn("12.9716", loc_data["dispatches"][0]["message"])

    def test_send_twilio_sms_mock_success(self):
        import unittest.mock as mock
        mock_resp = mock.MagicMock()
        mock_resp.read.return_value = json.dumps({"sid": "SMtest123", "status": "sent"}).encode()
        mock_resp.__enter__.return_value = mock_resp
        with mock.patch("urllib.request.urlopen", return_value=mock_resp):
            with mock.patch.dict(os.environ, {
                "TWILIO_ACCOUNT_SID": "test_dummy_twilio_sid",
                "TWILIO_AUTH_TOKEN": "secret_token",
                "TWILIO_PHONE_NUMBER": "+12055550199"
            }):
                res = app.send_twilio_sms("+919876543210", "Test Alert")
                self.assertTrue(res["ok"])
                self.assertEqual(res["status"], "sent")
                self.assertEqual(res["sid"], "SMtest123")


if __name__ == "__main__":
    unittest.main()
