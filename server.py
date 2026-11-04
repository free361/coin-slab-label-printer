# -*- coding: utf-8 -*-
"""钱币标签工具的本地小服务。

双击「启动标签工具.bat」会运行这个文件。
它只做两件事：
1. 在浏览器里打开网页（只能本机访问）。
2. 把录入的钱币保存在 data/coins.json，避免关了网页数据就丢。
"""

import json
import socket
import sys
import threading
import time
import webbrowser
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
DATA_DIR = ROOT / "data"
DATA_FILE = DATA_DIR / "coins.json"
BACKUP_FILE = DATA_DIR / "coins.bak.json"
HOST = "127.0.0.1"
PORT = 8765

# 第一次打开、还没有数据文件时，放两条原来 PSD 里的示例。
# 用户可以改，也可以删。删光之后文件还在，就不会再自动加回来。
SEED = [
    {
        "id": "c_sample_114",
        "name": "郡国五铢",
        "dynasty": "西汉",
        "feature": "穿上横文",
        "code": "一型-郡守十四-114",
        "serial": "2610300114",
        "diameter": "25.5",
        "thickness": "1.9",
        "weight": "4.1",
        "era": "汉武帝元狩五年至元鼎二年",
        "year": "前118年前115年",
        "note": "示例。来自 docs/五铢-114.psd，可以修改或删除。",
        "printed": False,
        "createdAt": "2026-10-30T12:00:00",
    },
    {
        "id": "c_sample_261",
        "name": "郡国五铢",
        "dynasty": "西汉",
        "feature": "三型一式宽字",
        "code": "郡守三十二-261",
        "serial": "2610300261",
        "diameter": "26.2",
        "thickness": "1.6",
        "weight": "3.4",
        "era": "汉武帝元狩五年至元鼎二年",
        "year": "前118年前115年",
        "note": "示例。来自 docs/整体排版.psd 里重复的那张，打印前请核对文字。",
        "printed": False,
        "createdAt": "2026-10-30T12:00:01",
    },
]


def log(message):
    """打印给使用者看的说明。出错时也能知道停在哪一步。"""
    print(message, flush=True)


def load_coins():
    """读出全部钱币。文件坏了就改名留底，避免下次保存把坏文件覆盖掉还没处找。"""
    if not DATA_FILE.exists():
        save_coins(SEED)
        return SEED, ""
    try:
        data = json.loads(DATA_FILE.read_text(encoding="utf-8"))
    except Exception as exc:
        bad = DATA_DIR / "coins.bad.json"
        try:
            DATA_FILE.replace(bad)
        except Exception as move_exc:
            log("数据文件读失败，而且没能改名留底：%s" % move_exc)
        log("数据文件坏了，已改名为 coins.bad.json。原因：%s" % exc)
        return [], "原来的数据读不出来，已改名为 data\\coins.bad.json。请不要删那个文件。"
    if not isinstance(data, list):
        return [], "数据文件格式不对，没有载入旧数据。"
    return data, ""


def save_coins(coins):
    """先把上一份存成 bak，再写入新文件。中途断电也不会只剩半个文件。"""
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if DATA_FILE.exists():
        BACKUP_FILE.write_text(DATA_FILE.read_text(encoding="utf-8"), encoding="utf-8")
    temp = DATA_FILE.with_suffix(".json.tmp")
    temp.write_text(json.dumps(coins, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(DATA_FILE)


class Handler(SimpleHTTPRequestHandler):
    """网页文件从 web 目录发，钱币数据走 /api/coins。"""

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(WEB_DIR), **kwargs)

    def log_message(self, fmt, *args):
        # 静态文件不刷屏。只留下接口和报错，方便看出保存有没有发生。
        request_line = args[0] if args else ""
        code = args[1] if len(args) > 1 else ""
        if "/api/" in str(request_line) or str(code).startswith(("4", "5")):
            log(fmt % args)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = urlparse(self.path).path
        if path == "/api/coins":
            coins, warning = load_coins()
            self._send_json({"ok": True, "coins": coins, "warning": warning})
            return
        if path == "/":
            self.path = "/index.html"
        return super().do_GET()

    def do_PUT(self):
        path = urlparse(self.path).path
        if path != "/api/coins":
            self.send_error(404)
            return
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length)
        try:
            data = json.loads(raw.decode("utf-8"))
        except Exception:
            self._send_json({"ok": False, "error": "数据格式不对，没有保存。"}, 400)
            return
        if not isinstance(data, list):
            self._send_json({"ok": False, "error": "数据应该是列表，没有保存。"}, 400)
            return
        try:
            save_coins(data)
        except Exception as exc:
            log("保存失败：%s" % exc)
            self._send_json({"ok": False, "error": "写入文件失败：%s" % exc}, 500)
            return
        log("已保存 %s 条钱币" % len(data))
        self._send_json({"ok": True, "count": len(data)})

    def _send_json(self, obj, code=200):
        body = json.dumps(obj, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def port_is_open(port):
    """判断工具是不是已经开着，避免同时开两个、抢着写同一个文件。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.4)
        return sock.connect_ex((HOST, port)) == 0


def main():
    if hasattr(sys.stdout, "reconfigure"):
        try:
            sys.stdout.reconfigure(encoding="utf-8")
        except Exception:
            pass

    url = "http://%s:%s/" % (HOST, PORT)
    if port_is_open(PORT):
        log("工具已经开着，帮你把网页再打开一次。")
        log(url)
        webbrowser.open(url)
        return

    if not WEB_DIR.exists():
        log("找不到 web 文件夹，工具没法打开。")
        sys.exit(1)

    # 事先准备好数据目录。真正的示例数据在第一次打开网页时写入。
    DATA_DIR.mkdir(parents=True, exist_ok=True)

    ThreadingHTTPServer.allow_reuse_address = True
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)

    def open_browser():
        time.sleep(0.6)
        webbrowser.open(url)

    threading.Thread(target=open_browser, daemon=True).start()
    log("================================")
    log("钱币标签工具已经打开")
    log("")
    log("请到浏览器里使用。")
    log("如果浏览器没有自动打开，请自己打开：")
    log(url)
    log("")
    log("用完后关闭这个黑窗口，工具就会停。")
    log("下次再用，重新双击「启动标签工具.bat」。")
    log("================================")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        log("已关闭。")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
