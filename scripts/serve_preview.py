#!/usr/bin/env python3
"""ローカルプレビュー用HTTPサーバー"""

import http.server
import sys
from pathlib import Path

WEB_DIR = Path(__file__).parent.parent / "web"


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8080

    class Handler(http.server.SimpleHTTPRequestHandler):
        def __init__(self, *args, **kwargs):
            super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    print(f"プレビューサーバー起動: http://localhost:{port}")
    print(f"配信ディレクトリ: {WEB_DIR}")
    print("Ctrl+C で停止")

    with http.server.HTTPServer(("", port), Handler) as httpd:
        httpd.serve_forever()


if __name__ == "__main__":
    main()
