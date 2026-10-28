#!/bin/sh
set -e
if [ -z "$AUTHORIZED_KEY" ]; then
  echo 'AUTHORIZED_KEY is empty: start this through test/integration/run.sh' >&2
  exit 1
fi
mkdir -p /home/deploy/.ssh
printf '%s\n' "$AUTHORIZED_KEY" > /home/deploy/.ssh/authorized_keys
chown -R deploy:deploy /home/deploy/.ssh
chmod 700 /home/deploy/.ssh
chmod 600 /home/deploy/.ssh/authorized_keys
exec /usr/sbin/sshd -D -e
