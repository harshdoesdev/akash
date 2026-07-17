#!/bin/bash
# cloud-init bootstrap for the akash relay — Amazon Linux 2023 arm64.
# Installs node + the ws room relay as a systemd service on port 8765.
# TLS lives in CloudFront (free *.cloudfront.net cert), not on this box.
# The relay source is deployed by scp (see deploy.sh); this only preps the
# box and the service unit.
set -euxo pipefail
exec > /var/log/akash-relay-init.log 2>&1

dnf install -y nodejs npm

mkdir -p /opt/akash-relay
useradd --system --home /opt/akash-relay --shell /sbin/nologin akash || true
chown -R akash:akash /opt/akash-relay

cat > /etc/systemd/system/akash-relay.service <<'EOF'
[Unit]
Description=akash multiplayer relay
After=network.target

[Service]
User=akash
WorkingDirectory=/opt/akash-relay
ExecStart=/usr/bin/node /opt/akash-relay/server.js
Restart=always
RestartSec=3
MemoryMax=300M

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable akash-relay
