#!/bin/bash
cd "$(dirname "$0")"
echo "=== Fix render3d.app Cloudflare origin (521/525) ==="
bash ./fix-cloudflare-origin.sh
echo
echo "Press Return to close..."
read _
