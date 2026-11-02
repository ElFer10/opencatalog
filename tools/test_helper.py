"""Tests for opencatalog-helper.py:  python3 -m unittest tools/test_helper.py"""
import importlib.util
import json
import os
import sqlite3
import tempfile
import threading
import unittest
import urllib.request
import urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("helper", os.path.join(HERE, "opencatalog-helper.py"))
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)


class HelperTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.mkdtemp()
        cls.db = os.path.join(cls.tmp, "catalog db.sqlite")
        con = sqlite3.connect(cls.db)
        con.execute("CREATE TABLE p (id INTEGER, name TEXT, price REAL, added DATE)")
        con.executemany("INSERT INTO p VALUES (?,?,?,?)", [(1, "Blåbärsmousse", 4.95, "2026-03-01"), (2, "Bröd", 12.0, None)])
        con.commit()
        con.close()
        cls.httpd = helper.serve(0, "tok", False)
        cls.port = cls.httpd.server_address[1]
        threading.Thread(target=cls.httpd.serve_forever, daemon=True).start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()

    def post(self, body, token="tok"):
        req = urllib.request.Request(f"http://127.0.0.1:{self.port}/query", data=json.dumps(body).encode(),
                                     headers={"Content-Type": "application/json", "X-OpenCatalog-Token": token}, method="POST")
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_health(self):
        with urllib.request.urlopen(f"http://127.0.0.1:{self.port}/health") as r:
            self.assertTrue(json.loads(r.read())["ok"])

    def test_select(self):
        status, res = self.post({"connection": f"sqlite:{self.db}", "sql": "SELECT id, name, price, added FROM p ORDER BY id"})
        self.assertEqual(status, 200)
        self.assertEqual(res["columns"], ["id", "name", "price", "added"])
        self.assertEqual(res["rows"], [[1, "Blåbärsmousse", 4.95, "2026-03-01"], [2, "Bröd", 12.0, None]])

    def test_token_required(self):
        status, res = self.post({"connection": f"sqlite:{self.db}", "sql": "SELECT 1"}, token="wrong")
        self.assertEqual(status, 403)

    def test_read_only(self):
        for sql in ["DELETE FROM p", "SELECT 1; DROP TABLE p", "/* x */ UPDATE p SET name='x'"]:
            status, res = self.post({"connection": f"sqlite:{self.db}", "sql": sql})
            self.assertEqual(status, 400, sql)
        status, res = self.post({"connection": f"sqlite:{self.db}", "sql": "-- comment\nWITH x AS (SELECT 2 AS n) SELECT n FROM x"})
        self.assertEqual(res["rows"], [[2]])

    def test_errors(self):
        self.assertEqual(self.post({"connection": "mysql:x", "sql": "SELECT 1"})[0], 400)
        status, res = self.post({"connection": f"sqlite:{self.db}", "sql": "SELECT nope FROM p"})
        self.assertEqual(status, 400)
        self.assertIn("nope", res["error"])


if __name__ == "__main__":
    unittest.main()
