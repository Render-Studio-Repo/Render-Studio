#!/bin/bash
cd "$(dirname "$0")"
echo "Installing Caddy for render3d.app (needs your Mac password)..."
bash ./install-caddy-ssl.sh
echo
echo "Press Return to close..."
read _
