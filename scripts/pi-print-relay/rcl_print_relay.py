#!/usr/bin/env python3
"""Royale print relay: the website's print queue -> the bar's old Epson TM-m30.

The original TM-m30 (M335A) can't fetch its own print jobs from the website
the way the newer printers do (Epson Server Direct Print). This runs on a
Raspberry Pi on the same network and does it for it:

  1. Every few seconds it asks the website for print jobs, exactly like a
     Server Direct Print printer would (POST ConnectionType=GetRequest to
     /api/print/poll, with this relay's ID and password from Back office ->
     Printers).
  2. Each job is plain ePOS-Print XML. It posts it to the printer over the
     local network: http://<printer IP>/cgi-bin/epos/service.cgi, in the same
     SOAP envelope the register's browser used to send.
  3. It tells the website how each one went (ConnectionType=SetResponse), so
     failures are retried and show up on the Printers page.

Python 3 standard library only: nothing to pip install.

Settings come from the environment (systemd loads /etc/rcl-print-relay.conf),
or from a file given with --config:

  RCL_POLL_URL          https://rcl-app.vercel.app/api/print/poll
  RCL_PRINTER_ID        the ID shown when the relay was added (rcl-...)
  RCL_PRINTER_PASSWORD  the password shown then
  RCL_PRINTER_IP        the TM-m30's address (default 10.0.0.175)
  RCL_INTERVAL          seconds between checks (default 5)

Run once by hand to test:  python3 rcl_print_relay.py --config /etc/rcl-print-relay.conf --once
"""

import argparse
import base64
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from xml.sax.saxutils import escape

VERSION = "1.0"
EPOS_NS = "http://www.epson-pos.com/schemas/2011/03/epos-print"


def log(msg):
    # journald adds the time; keep job contents (customer names) out of logs.
    print(msg, flush=True)


def load_config(path):
    values = {}
    if path:
        with open(path, encoding="utf-8") as f:
            for raw in f:
                line = raw.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                values[key.strip()] = value.strip().strip('"').strip("'")

    def get(key, default=None):
        return os.environ.get(key) or values.get(key) or default

    cfg = {
        "poll_url": get("RCL_POLL_URL", ""),
        "id": get("RCL_PRINTER_ID", ""),
        "password": get("RCL_PRINTER_PASSWORD", ""),
        "printer_ip": get("RCL_PRINTER_IP", "10.0.0.175"),
        "interval": float(get("RCL_INTERVAL", "5")),
        # Only for testing against a stand-in printer; normally built from the IP.
        "printer_url": get("RCL_PRINTER_URL", ""),
        "name": get("RCL_NAME", "pi-relay"),
    }
    names = {"poll_url": "RCL_POLL_URL", "id": "RCL_PRINTER_ID", "password": "RCL_PRINTER_PASSWORD"}
    missing = [names[k] for k in names if not cfg[k] or "PASTE" in cfg[k]]
    if missing:
        sys.exit("Missing settings: " + ", ".join(missing) + ". Put them in /etc/rcl-print-relay.conf (see README.md).")
    if not cfg["poll_url"].startswith("https://") and not cfg["poll_url"].startswith("http://localhost") and not cfg["poll_url"].startswith("http://127.0.0.1"):
        sys.exit("RCL_POLL_URL must be the website's https:// address.")
    if cfg["interval"] < 2:
        cfg["interval"] = 2.0
    return cfg


class Relay:
    def __init__(self, cfg):
        self.cfg = cfg
        token = base64.b64encode(f"{cfg['id']}:{cfg['password']}".encode("utf-8")).decode("ascii")
        self.auth = "Basic " + token

    # ---------- the website ----------
    def post_server(self, fields):
        data = urllib.parse.urlencode(fields).encode("utf-8")
        req = urllib.request.Request(
            self.cfg["poll_url"],
            data=data,
            method="POST",
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Authorization": self.auth,
                "User-Agent": f"rcl-print-relay/{VERSION}",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, r.read().decode("utf-8", "replace"), r.headers
        except urllib.error.HTTPError as e:
            return e.code, e.read().decode("utf-8", "replace"), e.headers

    # ---------- the printer ----------
    def printer_url(self, timeout_ms):
        if self.cfg["printer_url"]:
            base = self.cfg["printer_url"]
        else:
            base = f"http://{self.cfg['printer_ip']}/cgi-bin/epos/service.cgi"
        return f"{base}?devid=local_printer&timeout={timeout_ms}"

    def print_job(self, epos_xml, timeout_ms):
        """Sends one ePOS-Print document to the TM-m30. Returns (ok, code)."""
        body = (
            '<?xml version="1.0" encoding="utf-8"?>'
            '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body>'
            + epos_xml
            + "</s:Body></s:Envelope>"
        )
        req = urllib.request.Request(
            self.printer_url(timeout_ms),
            data=body.encode("utf-8"),
            method="POST",
            headers={
                "Content-Type": "text/xml; charset=utf-8",
                "If-Modified-Since": "Thu, 01 Jan 1970 00:00:00 GMT",
                "SOAPAction": '""',
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout_ms / 1000 + 10) as r:
                text = r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            text = e.read().decode("utf-8", "replace")
            if "<response" not in text:
                return False, f"HTTP_{e.code}"
        except (urllib.error.URLError, OSError):
            return False, "RELAY_UNREACHABLE"
        success = re.search(r'<response[^>]*\bsuccess="(true|false)"', text)
        code = re.search(r'<response[^>]*\bcode="([^"]*)"', text)
        if success and success.group(1) == "true":
            return True, ""
        return False, (code.group(1) if code and code.group(1) else "PRINTER_ERROR")

    # ---------- one round ----------
    def poll_once(self):
        """Asks for jobs, prints them, reports back. Returns seconds to wait."""
        status, body, headers = self.post_server({"ConnectionType": "GetRequest", "ID": self.cfg["id"], "Name": self.cfg["name"]})
        if status == 401:
            log("The website didn't accept this relay's ID and password. Check /etc/rcl-print-relay.conf against Back office -> Printers.")
            return 60
        if status == 429:
            wait = headers.get("Retry-After", "30") if headers else "30"
            return float(wait) if str(wait).isdigit() else 30
        if status != 200:
            log(f"The website answered {status}; trying again shortly.")
            return self.cfg["interval"] * 2
        if not body.strip():
            return self.cfg["interval"]

        results = []
        for block in re.findall(r"<ePOSPrint>(.*?)</ePOSPrint>", body, re.S):
            job_id = re.search(r"<printjobid>(.*?)</printjobid>", block, re.S)
            timeout = re.search(r"<timeout>(\d+)</timeout>", block)
            data = re.search(r"<PrintData>(.*?)</PrintData>", block, re.S)
            if not job_id or not data:
                continue
            timeout_ms = min(int(timeout.group(1)) if timeout else 10000, 60000)
            ok, code = self.print_job(data.group(1).strip(), timeout_ms)
            log(f"job {job_id.group(1).strip()}: {'printed' if ok else 'failed ' + code}")
            results.append((job_id.group(1).strip(), ok, code))

        if results:
            parts = "".join(
                "<ePOSPrint><Parameter><devid>local_printer</devid>"
                f"<printjobid>{escape(jid)}</printjobid></Parameter><PrintResponse>"
                f'<response xmlns="{EPOS_NS}" success="{"true" if ok else "false"}" code="{escape(code)}" status="0" battery="0"/>'
                "</PrintResponse></ePOSPrint>"
                for jid, ok, code in results
            )
            response_file = f'<?xml version="1.0" encoding="utf-8"?><PrintResponseInfo Version="2.00">{parts}</PrintResponseInfo>'
            for attempt in range(3):
                status, _, _ = self.post_server({"ConnectionType": "SetResponse", "ID": self.cfg["id"], "ResponseFile": response_file})
                if status == 200:
                    break
                time.sleep(2 + attempt * 3)
            else:
                log("Couldn't tell the website how the jobs went; it will sort them out on its own.")
        # More may be waiting: ask again soon.
        return 0.5 if results else self.cfg["interval"]


def main():
    parser = argparse.ArgumentParser(description="Relay the Royale website's print jobs to the bar's TM-m30.")
    parser.add_argument("--config", help="settings file (KEY=VALUE lines), e.g. /etc/rcl-print-relay.conf")
    parser.add_argument("--once", action="store_true", help="check for jobs once, then stop (for testing)")
    args = parser.parse_args()
    cfg = load_config(args.config)
    relay = Relay(cfg)
    target = cfg["printer_url"] or cfg["printer_ip"]
    log(f"rcl-print-relay {VERSION}: {cfg['poll_url']} -> {target} every {cfg['interval']:g}s")
    while True:
        try:
            wait = relay.poll_once()
        except Exception as e:  # keep going through network hiccups
            log(f"Trouble reaching the website ({type(e).__name__}); trying again shortly.")
            wait = cfg["interval"] * 2
        if args.once:
            return
        time.sleep(wait)


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
