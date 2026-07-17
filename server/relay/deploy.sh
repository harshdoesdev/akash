#!/bin/bash
# Deploy the relay to the EC2 box (see server/relay/README.md for the infra).
set -euo pipefail
HOST="${1:-3.95.74.17}"
KEY="${2:-$HOME/.ssh/akash-relay.pem}"
DIR="$(cd "$(dirname "$0")" && pwd)"

scp -i "$KEY" "$DIR/server.js" "$DIR/auth.js" "$DIR/schema.js" "$DIR/package.json" "ec2-user@$HOST:/tmp/"
ssh -i "$KEY" "ec2-user@$HOST" '
  set -e
  # node 22 (AL2023 default nodejs is too old for better-sqlite3 v12)
  if ! node --version 2>/dev/null | grep -q "^v22"; then
    sudo dnf remove -y nodejs npm >/dev/null 2>&1 || true
    sudo dnf install -y nodejs22 nodejs22-npm >/dev/null
    sudo alternatives --install /usr/bin/node node /usr/bin/node-22 100 2>/dev/null || true
  fi
  node --version

  sudo mv /tmp/server.js /tmp/auth.js /tmp/schema.js /tmp/package.json /opt/akash-relay/

  # secrets + config live in an env file the unit reads; mint the secret once
  if ! sudo test -f /opt/akash-relay/.env; then
    echo "BETTER_AUTH_SECRET=$(openssl rand -base64 32)" | sudo tee /opt/akash-relay/.env >/dev/null
    echo "AUTH_BASE_URL=https://d1pksxqb8ts7db.cloudfront.net" | sudo tee -a /opt/akash-relay/.env >/dev/null
    echo "DB_PATH=/opt/akash-relay/data/akash.db" | sudo tee -a /opt/akash-relay/.env >/dev/null
    sudo chmod 600 /opt/akash-relay/.env
  fi
  sudo grep -q EnvironmentFile /etc/systemd/system/akash-relay.service || {
    sudo sed -i "/^WorkingDirectory=/a EnvironmentFile=/opt/akash-relay/.env" /etc/systemd/system/akash-relay.service
    sudo systemctl daemon-reload
  }

  cd /opt/akash-relay && sudo npm install --omit=dev 2>&1 | tail -1
  sudo mkdir -p /opt/akash-relay/data
  sudo chown -R akash:akash /opt/akash-relay
  sudo systemctl restart akash-relay
  sleep 2 && systemctl is-active akash-relay && curl -s http://127.0.0.1:8765/
'
