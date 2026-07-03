import os from "node:os";

// Pick the most likely LAN IPv4 address for guests to reach this laptop.
// Filters to non-internal IPv4 addresses in private ranges, and prefers
// common Wi-Fi/Ethernet interface names over virtual ones (VPN, Docker, vEthernet).
export function detectLanIp(override) {
  if (override) return override;

  const ifaces = os.networkInterfaces();
  const candidates = [];

  for (const [name, addrs] of Object.entries(ifaces)) {
    for (const a of addrs || []) {
      if (a.family !== "IPv4" || a.internal) continue;
      if (!isPrivate(a.address)) continue;
      candidates.push({ name, address: a.address });
    }
  }

  if (candidates.length === 0) return "127.0.0.1";

  const score = (name) => {
    const n = name.toLowerCase();
    if (/(docker|veth|vmnet|vboxnet|bridge|tun|tap|utun|llw|awdl)/.test(n)) return -1; // virtual/VPN
    if (/^en0|wlan0|wi-?fi|wlp/.test(n)) return 2; // primary wifi
    if (/^en\d|eth\d|enp/.test(n)) return 1; // ethernet
    return 0;
  };

  candidates.sort((a, b) => score(b.name) - score(a.name));
  return candidates[0].address;
}

function isPrivate(ip) {
  return (
    ip.startsWith("10.") ||
    ip.startsWith("192.168.") ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(ip)
  );
}
