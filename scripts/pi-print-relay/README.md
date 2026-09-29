# Pi print relay: the bar's old TM-m30

The bar's original Epson TM-m30 (model M335A, at 10.0.0.175) can't collect its
own print jobs from the website the way the new printers do. This small
program runs on a Raspberry Pi on the same network and does it for it: every
few seconds it asks the website for the bar's print jobs and passes each one
to the TM-m30 over the local network. Nothing to install from the internet;
it only needs the Python 3 that comes with Raspberry Pi OS.

Once it's running, the bar register can switch to "Print through the
website" under Devices, and the iPad never has to accept the printer's
certificate again.

## 1. Add the relay on the website

1. Back office → **Printers** → **Add printer**.
2. Name: `Bar printer`. Where it is: `Bar`.
3. What kind: **The old TM-m30 at the bar, through the Raspberry Pi relay**.
4. What it prints: **Bar receipts**.
5. Save. The page shows the settings for the Pi, including a password it
   shows **only once**. Leave that page open for step 3.

## 2. Copy this folder to the Pi

From the computer that has this code (PowerShell or Terminal), with the Pi's
address in place of `PI-ADDRESS` and your Pi user in place of `pi`:

```
scp -r scripts/pi-print-relay pi@PI-ADDRESS:~/
```

## 3. Install it

SSH into the Pi:

```
ssh pi@PI-ADDRESS
cd ~/pi-print-relay
sudo sh install.sh
```

It says it made `/etc/rcl-print-relay.conf`. Open it:

```
sudo nano /etc/rcl-print-relay.conf
```

Replace the two `PASTE-THE-...` lines with the ID and password from the
Printers page (the page shows the whole file; you can paste all of it over
what's there). Save with **Ctrl+O**, **Enter**, then **Ctrl+X**. Start it:

```
sudo systemctl restart rcl-print-relay
```

## 4. Check it

```
systemctl status rcl-print-relay
```

should say `active (running)`. On the Printers page the Bar printer should
say **Online** within a minute. Press **Test print**: a test page comes out
of the TM-m30. Then, on the bar register: Devices → **Print through the
website**, and **Print a test page** there too.

It starts on its own whenever the Pi boots.

## Handy commands

| What | Command |
| --- | --- |
| Watch what it's doing | `journalctl -u rcl-print-relay -f` (Ctrl+C to stop watching) |
| Restart it | `sudo systemctl restart rcl-print-relay` |
| Stop it | `sudo systemctl stop rcl-print-relay` |
| Try one round by hand | `sudo python3 /opt/rcl-print-relay/rcl_print_relay.py --config /etc/rcl-print-relay.conf --once` |
| Update it after a code change | copy the folder over again (step 2), then `cd ~/pi-print-relay && sudo sh install.sh` |

## If something's wrong

- **"didn't accept this relay's ID and password"** in the log: the ID or
  password in `/etc/rcl-print-relay.conf` doesn't match. On the Printers page
  press **New password** on the Bar printer, paste the new one in, restart.
- **Jobs fail with "The Pi relay couldn't reach the printer"**: the TM-m30 is
  off, unplugged, or has a new IP address. Print its status sheet (open the
  paper cover, hold Feed for 3 seconds, close the cover), then fix
  `RCL_PRINTER_IP` in `/etc/rcl-print-relay.conf` and restart.
- **`install.sh: bad interpreter` or `$'\r': command not found`**: the files
  picked up Windows line endings. Run `sed -i 's/\r$//' install.sh` and try
  again.
- **Printers page says "Never connected"**: the Pi needs the internet. Try
  `curl -I https://rcl-app.vercel.app` on the Pi.

The relay never logs what's on a receipt, only job numbers and whether they
printed.
