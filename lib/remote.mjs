// Coulisses in the browser of the user's iPad (or of any device of the user's Tailscale network) — not a remote desktop
// (user request, 18/10/2026: « que je puisse accéder aux Coulisses depuis mon iPad à distance, mais pas en remote »).
// Coulisses still listens on this PC's loopback only; Tailscale's own « serve » brings each of its ports to the user's
// tailnet over HTTPS — https://<pc>.<tailnet>.ts.net:<port>, the hub's and each studio's —, at home or away, to the
// user's devices only (never « funnel »: nothing on the Internet), with no port opened in Windows' firewall.
// A request from there reaches Coulisses through tailscaled, on the loopback, with the Host of that name and the
// login of the one who asks (Tailscale-User-Login): lib/guard.mjs lets it in when both are this PC's, and the setting
// is on (Fichier › Accès depuis l'iPad…, settings.json « browserAccess »).
// Only the ports of Coulisses (4170-4199, each to itself) are ever added to or taken from Tailscale's serve config:
// anything else served there (another program's) is never touched.
// COULISSES_TEST_TAILNET="<name>,<login>": the tests' tailnet (no Tailscale needed); COULISSES_TEST_NO_SERVE=1: no
// `tailscale serve` run.
import fs from 'node:fs';
import { execFile, spawnSync } from 'node:child_process';
import { readSettings, writeSettings } from './i18n.mjs';
import { HUB_PORT, LAST_PORT } from './app-profile.mjs';

const EXE = ['C:\\Program Files\\Tailscale\\tailscale.exe', 'C:\\Program Files (x86)\\Tailscale\\tailscale.exe'].find((f) => fs.existsSync(f)) ?? 'tailscale';
export const PORTS = [HUB_PORT, LAST_PORT];
const ours = (p) => p >= PORTS[0] && p <= PORTS[1];

export const browserAccessWanted = () => readSettings().browserAccess === true;
export const setBrowserAccess = (on) => writeSettings({ browserAccess: !!on });

// what Tailscale says of this PC: { ok, dns (its HTTPS name), login (its user), ip, why }
let memo = null, asking = false;
function parse(out, err) {
  if (err && !out) return { ok: false, why: err.code === 'ENOENT' ? 'absent' : String(err.message ?? err).slice(0, 200), at: Date.now() };
  let j; try { j = JSON.parse(out); } catch { return { ok: false, why: 'status', at: Date.now() }; }
  if (j.BackendState !== 'Running' || !j.Self) return { ok: false, why: j.BackendState ? `stopped (${j.BackendState})` : 'stopped', at: Date.now() };
  const dns = String(j.Self.DNSName ?? '').replace(/\.$/, '').toLowerCase();
  const login = String(j.User?.[j.Self.UserID]?.LoginName ?? '').toLowerCase();
  return { ok: !!dns && !!login, dns, login, ip: j.Self.TailscaleIPs?.[0] ?? null, https: (j.CertDomains ?? []).map((d) => d.toLowerCase()).includes(dns), why: dns ? null : 'no name', at: Date.now() };
}
export function tailnet({ fresh = false } = {}) {
  if (process.env.COULISSES_TEST_TAILNET) { const [dns, login] = process.env.COULISSES_TEST_TAILNET.toLowerCase().split(','); return { ok: true, dns, login, https: true }; }
  if (memo && !fresh) {
    if (Date.now() - memo.at > 60000 && !asking) {   // (known: answered now, asked again in the background)
      asking = true;
      execFile(EXE, ['status', '--json'], { windowsHide: true, timeout: 8000, maxBuffer: 8e6 }, (e, out) => { asking = false; memo = parse(out, e); });
    }
    return memo;
  }
  const r = spawnSync(EXE, ['status', '--json'], { encoding: 'utf8', windowsHide: true, timeout: 8000, maxBuffer: 8e6 });
  memo = parse(r.stdout, r.error);
  return memo;
}

// the request came from the user's tailnet, through Tailscale's serve (and Coulisses lets it in)
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
export function viaTailnet(req) {
  if (!browserAccessWanted()) return false;
  const T = tailnet(); if (!T.ok) return false;
  const host = String(req.headers.host ?? '').toLowerCase().replace(/:\d+$/, '');
  if (host !== T.dns) return false;
  if (!LOOPBACK.has(req.socket?.remoteAddress ?? '')) return false;   // (tailscaled is on this PC)
  return String(req.headers['tailscale-user-login'] ?? '').toLowerCase() === T.login;   // the user of this PC
}
// an address Coulisses gives out (a studio's, the hub's), as the one who asks can reach it: the tailnet's name from there
export function publicUrl(req, url) {
  if (!url || !viaTailnet(req)) return url;
  return String(url).replace(/^https?:\/\/(?:127\.0\.0\.1|localhost|\[::1\]):(\d+)/i, (m, port) => `https://${tailnet().dns}:${port}`);
}

// Tailscale's serve: a port of Coulisses brought to the tailnet (or taken back)
const run = (args) => new Promise((resolve) => {
  if (process.env.COULISSES_TEST_NO_SERVE) return resolve({ ok: true, out: '' });
  execFile(EXE, args, { windowsHide: true, timeout: 20000 }, (e, out, err) => resolve({ ok: !e, out: String(out ?? ''), err: String(err || e?.message || '').trim().slice(0, 300) }));
});
export const serve = (port) => (ours(port) ? run(['serve', '--bg', `--https=${port}`, `http://127.0.0.1:${port}`]) : Promise.resolve({ ok: false, err: 'not ours' }));
export const unserve = (port) => (ours(port) ? run(['serve', `--https=${port}`, 'off']) : Promise.resolve({ ok: false, err: 'not ours' }));
// the ports of Coulisses served now: those of Tailscale's config that go to themselves on the loopback (4170-4199)
export async function servedPorts() {
  if (process.env.COULISSES_TEST_NO_SERVE) return [];
  const r = await run(['serve', 'status', '--json']);
  let j; try { j = JSON.parse(r.out || '{}'); } catch { return []; }
  const out = new Set();
  for (const [hostPort, web] of Object.entries(j.Web ?? {})) {
    const port = +String(hostPort).split(':').pop();
    for (const h of Object.values(web?.Handlers ?? {})) if (ours(port) && h?.Proxy === `http://127.0.0.1:${port}`) out.add(port);
  }
  return [...out].sort((a, b) => a - b);
}
export async function unserveAll() { for (const p of await servedPorts()) await unserve(p); }
