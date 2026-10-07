#!/usr/bin/env bash
# Install Caddy and switch public traffic from nginx to Caddy for Render3D.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CADDYFILE_SRC="${ROOT}/deploy/Caddyfile"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/install-caddy.sh" >&2
  exit 1
fi

if ! command -v caddy >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -qq
  apt-get install -y caddy
fi

install -d -m 755 /etc/caddy
install -m 644 "${CADDYFILE_SRC}" /etc/caddy/Caddyfile

# Free ports 80/443 for Caddy (nginx currently owns :80 on this host).
if systemctl is-active --quiet nginx; then
  systemctl stop nginx
  systemctl disable nginx
fi

systemctl enable caddy
systemctl reload caddy || systemctl restart caddy
systemctl --no-pager status caddy

echo
echo "=== IMPORTANT: AWS Security Group ==="
echo "Open inbound TCP 80 and 443 on security group 'launch-wizard-9' for this EC2 instance."
echo "EC2 → Instances → Security → Inbound rules → Add: HTTP (80), HTTPS (443) from 0.0.0.0/0"
echo
echo "=== DNS ==="
echo "Point smartcallusa.com AND www.smartcallusa.com to: $(curl -s --max-time 2 http://169.254.169.254/latest/meta-data/public-ipv4 || echo 'this server IP')"
echo
echo "Caddy will proxy http://smartcallusa.com -> 127.0.0.1:8001"
echo "Until port 80 is open, use: http://smartcallusa.com:8001"
