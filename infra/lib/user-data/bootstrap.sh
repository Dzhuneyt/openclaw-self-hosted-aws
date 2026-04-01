#!/bin/bash
set -euo pipefail
exec > >(tee /var/log/openclaw-bootstrap.log) 2>&1

REGION=$(ec2metadata --availability-zone | sed 's/.$//')

echo "=== [1/4] Data volume ==="
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y curl jq unzip nvme-cli

# Find the data volume device — NVMe remaps /dev/sdf to /dev/nvme*n1
DATA_DEVICE=""
for dev in /dev/nvme1n1 /dev/sdf /dev/xvdf; do
  if [ -b "$dev" ]; then
    DATA_DEVICE="$dev"
    break
  fi
done

if [ -z "$DATA_DEVICE" ]; then
  echo "ERROR: Data volume device not found"
  exit 1
fi

# Format only on first boot (no existing filesystem)
if ! blkid "$DATA_DEVICE" > /dev/null 2>&1; then
  echo "First boot — formatting $DATA_DEVICE"
  mkfs.ext4 "$DATA_DEVICE"
fi

mkdir -p /data
mount "$DATA_DEVICE" /data

# Add to fstab if not already there (use UUID for stability)
DATA_UUID=$(blkid -s UUID -o value "$DATA_DEVICE")
if ! grep -q "$DATA_UUID" /etc/fstab; then
  echo "UUID=$DATA_UUID /data ext4 defaults,nofail 0 2" >> /etc/fstab
fi

mkdir -p /data/openclaw
chown ubuntu:ubuntu /data/openclaw

echo "=== [2/4] Docker ==="
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo "$VERSION_CODENAME") stable" | \
  tee /etc/apt/sources.list.d/docker.list > /dev/null

apt-get update -y
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
usermod -aG docker ubuntu

echo "=== [3/4] AWS CLI v2, Node 22, OpenClaw ==="
# AWS CLI v2 (awscli apt package doesn't exist on Ubuntu 24.04)
curl -fsSL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o /tmp/awscliv2.zip
unzip -q /tmp/awscliv2.zip -d /tmp
/tmp/aws/install
rm -rf /tmp/aws /tmp/awscliv2.zip

# Node 22 via NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt-get install -y nodejs

# OpenClaw
npm install -g openclaw@latest

echo "=== [4/4] Tailscale ==="
curl -fsSL https://tailscale.com/install.sh | sh

TS_AUTH_KEY=$(aws ssm get-parameter \
  --name "/openclaw/tailscale/auth-key" \
  --with-decryption \
  --query "Parameter.Value" \
  --output text \
  --region "$REGION") || true

if [ -n "$TS_AUTH_KEY" ] && [ "$TS_AUTH_KEY" != "CHANGE_ME" ]; then
  tailscale up --authkey="$TS_AUTH_KEY" --hostname=openclaw-ec2
  echo "Tailscale connected."
else
  echo "WARNING: Tailscale auth key not set. Run 'tailscale up' manually after updating SSM."
fi

echo ""
echo "=========================================="
echo "  BOOTSTRAP COMPLETE"
echo ""
echo "  Next steps (SSM into instance):"
echo "  1. openclaw onboard --install-daemon"
echo "  2. openclaw gateway --tailscale serve"
echo "=========================================="

echo "=== Bootstrap complete ==="
