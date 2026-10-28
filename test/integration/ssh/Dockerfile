# Minimal SSH host for integration tests: key-only login as "deploy".
FROM alpine:3.20
RUN apk add --no-cache openssh bash gzip \
 && ssh-keygen -A \
 && adduser -D -s /bin/bash deploy \
 # adduser locks the account ("!"), which sshd refuses even for key logins.
 && sed -i 's/^deploy:!/deploy:*/' /etc/shadow \
 && mkdir -p /var/www/site \
 && chown deploy:deploy /var/www/site \
 # sshd keeps the first value it reads, so edit the defaults in place.
 && sed -i -E 's/^#?(AllowTcpForwarding|PasswordAuthentication).*//' /etc/ssh/sshd_config \
 && printf 'PasswordAuthentication no\nAllowTcpForwarding yes\n' >> /etc/ssh/sshd_config
COPY entrypoint.sh /entrypoint.sh
EXPOSE 22
ENTRYPOINT ["/bin/sh", "/entrypoint.sh"]
