#!/usr/bin/env python3
"""
Gunther · console preview server.

A plain static file server that refuses to let anything go stale:
every response carries `Cache-Control: no-store`, so browsers and
proxies can never hand you a previous build of the house.

    python3 server.py            # http://localhost:8000
    python3 server.py 9000       # any other port
"""

import http.server
import sys


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store, max-age=0")
        super().end_headers()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8000
    print(f"Gunther console — http://0.0.0.0:{port}  (no-cache)")
    http.server.ThreadingHTTPServer(("0.0.0.0", port), NoCacheHandler).serve_forever()
