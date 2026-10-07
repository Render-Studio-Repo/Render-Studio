#!/bin/bash
cd "$(dirname "$0")"
echo "=== Persistent services: Render Studio + Healthy Justice ==="
echo
bash ./setup-persistent-services.sh
echo
echo "Press Return to close..."
read _
