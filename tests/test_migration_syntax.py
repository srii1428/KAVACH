import unittest
from pathlib import Path

class MigrationSyntaxTestCase(unittest.TestCase):
    def test_migration_file_exists_and_contains_rls(self):
        sql_path = Path("migrations/001_create_contacts_and_incidents.sql")
        self.assertTrue(sql_path.exists(), "Migration file does not exist")
        sql = sql_path.read_text().lower()
        self.assertIn("create table if not exists public.contacts", sql)
        self.assertIn("alter table public.contacts enable row level security", sql)
        self.assertIn("auth.uid() = user_id", sql)
        self.assertIn("create table if not exists public.incidents", sql)
        self.assertIn("alter table public.incidents enable row level security", sql)

if __name__ == "__main__":
    unittest.main()
