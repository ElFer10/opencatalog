#!/usr/bin/env python3
"""
OpenCatalog helper: lets the InDesign panel read SQL databases.

UXP plugins cannot open database connections, so this small local server runs SQL queries for the
panel and returns the rows as JSON. It only listens on 127.0.0.1 and requires a token.

  python3 opencatalog-helper.py                  # SQLite (built in)
  python3 opencatalog-helper.py --port 8765 --token my-secret

Connections (sent by the panel):
  sqlite:/Users/me/data/catalog.db               opened read-only
  odbc:DSN=Products;UID=reader;PWD=...           needs `pip install pyodbc` and an ODBC driver

Only SELECT/WITH queries are accepted unless --allow-write is given.
Standard library only (pyodbc optional). License: Apache-2.0.
"""
import argparse
import base64
import datetime
import decimal
import json
import re
import secrets
import sqlite3
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import quote

VERSION = "1.0"
MAX_ROWS = 100_000

try:  # optional
    import pyodbc  # type: ignore
except Exception:  # pragma: no cover - depends on the machine
    pyodbc = None


class QueryError(Exception):
    pass


def strip_sql_comments(sql: str) -> str:
    sql = re.sub(r"/\*.*?\*/", " ", sql, flags=re.S)
    return re.sub(r"--[^\n]*", " ", sql)


def check_read_only(sql: str) -> None:
    body = strip_sql_comments(sql).strip().rstrip(";").strip()
    if ";" in body:
        raise QueryError("Only one statement per query is allowed")
    if not re.match(r"(?is)^(select|with)\b", body):
        raise QueryError("Only SELECT or WITH queries are allowed (start the helper with --allow-write to change this)")


def to_json_value(v):
    if v is None or isinstance(v, (bool, int, float, str)):
        return v
    if isinstance(v, decimal.Decimal):
        return float(v)
    if isinstance(v, (datetime.datetime, datetime.date, datetime.time)):
        return v.isoformat()
    if isinstance(v, (bytes, bytearray, memoryview)):
        return base64.b64encode(bytes(v)).decode("ascii")
    return str(v)


def run_query(connection: str, sql: str, allow_write: bool):
    if not allow_write:
        check_read_only(sql)
    if connection.startswith("sqlite:"):
        path = connection[len("sqlite:"):]
        if not path:
            raise QueryError("sqlite: connection needs a file path")
        uri = f"file:{quote(path)}" + ("" if allow_write else "?mode=ro")
        try:
            conn = sqlite3.connect(uri, uri=True)
        except sqlite3.Error as e:
            raise QueryError(f"Cannot open {path}: {e}")
    elif connection.startswith("odbc:"):
        if pyodbc is None:
            raise QueryError("ODBC needs the pyodbc package: pip install pyodbc")
        try:
            conn = pyodbc.connect(connection[len("odbc:"):], readonly=not allow_write)
        except Exception as e:  # pragma: no cover
            raise QueryError(f"ODBC connection failed: {e}")
    else:
        raise QueryError('Connection must start with "sqlite:" or "odbc:"')
    try:
        cur = conn.cursor()
        cur.execute(sql)
        columns = [d[0] for d in (cur.description or [])]
        rows = []
        for row in cur:
            rows.append([to_json_value(v) for v in row])
            if len(rows) >= MAX_ROWS:
                break
        if allow_write:
            conn.commit()
        return {"columns": columns, "rows": rows, "truncated": len(rows) >= MAX_ROWS}
    except Exception as e:
        raise QueryError(str(e))
    finally:
        conn.close()


def make_handler(token: str, allow_write: bool):
    class Handler(BaseHTTPRequestHandler):
        server_version = f"OpenCatalogHelper/{VERSION}"

        def log_message(self, fmt, *args):  # quieter log
            sys.stderr.write("[helper] " + (fmt % args) + "\n")

        def _send(self, status: int, payload: dict):
            body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
            self.send_response(status)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Access-Control-Allow-Origin", "*")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, X-OpenCatalog-Token")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            self._send(204, {})

        def do_GET(self):
            if self.path.rstrip("/") == "/health":
                return self._send(200, {"ok": True, "version": VERSION, "odbc": pyodbc is not None, "write": allow_write})
            self._send(404, {"error": "not found"})

        def do_POST(self):
            if self.path.rstrip("/") != "/query":
                return self._send(404, {"error": "not found"})
            if not secrets.compare_digest(self.headers.get("X-OpenCatalog-Token", ""), token):
                return self._send(403, {"error": "invalid token"})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                req = json.loads(self.rfile.read(length) or b"{}")
                result = run_query(str(req.get("connection", "")), str(req.get("sql", "")), allow_write)
                self._send(200, result)
            except QueryError as e:
                self._send(400, {"error": str(e)})
            except (ValueError, json.JSONDecodeError):
                self._send(400, {"error": "invalid JSON request"})

    return Handler


def serve(port: int, token: str, allow_write: bool) -> ThreadingHTTPServer:
    return ThreadingHTTPServer(("127.0.0.1", port), make_handler(token, allow_write))


def main(argv=None):
    ap = argparse.ArgumentParser(description="OpenCatalog database helper")
    ap.add_argument("--port", type=int, default=8765)
    ap.add_argument("--token", default=None, help="shared secret; a random one is generated when omitted")
    ap.add_argument("--allow-write", action="store_true", help="allow statements other than SELECT/WITH")
    args = ap.parse_args(argv)
    token = args.token or secrets.token_urlsafe(18)
    httpd = serve(args.port, token, args.allow_write)
    print(f"OpenCatalog helper {VERSION} on http://127.0.0.1:{args.port}")
    print(f"Token: {token}")
    print(f"ODBC: {'available' if pyodbc else 'not installed (pip install pyodbc)'} · writes: {'allowed' if args.allow_write else 'blocked'}")
    print("Press Ctrl+C to stop.")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
