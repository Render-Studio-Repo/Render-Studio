#!/bin/bash
cd "$(dirname "$0")"
echo "=== Cloudflare Tunnel setup for render3d.app ==="
echo "A browser will open — log into Cloudflare and select the render3d.app zone."
echo
bash ./setup-cloudflare-tunnel.sh
echo
echo "Press Return to close..."
read _
