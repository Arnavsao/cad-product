# Enabling HTTPS/TLS

The default `nginx.conf` serves plain HTTP on port 80. That's deliberate for
day one: it works behind any TLS-terminating load balancer (Cloudflare, an
AWS ALB, a Vercel/Fly/Render edge, a Caddy/Traefik reverse proxy) without
extra setup, and those are the common paths for this kind of deployment.

**If TLS is terminated upstream of this container, you don't need to do
anything below** — just make sure the proxy forwards `X-Forwarded-Proto` and
that's already read by `nginx.conf`'s `location ^~ /api/` block.

**If this container is the public-facing edge** (bare VM, no CDN/LB in
front), follow this to terminate TLS in nginx itself with a free Let's
Encrypt certificate:

## One-time cutover

1. **Point DNS** at the host first — Let's Encrypt validates ownership over
   HTTP, so the domain must already resolve here.

2. **Edit `nginx.ssl.conf`**: replace both `server_name _;` lines with your
   real domain(s), and the two `CHANGE_ME` segments in the `ssl_certificate`
   paths with that same domain.

3. **Get a certificate** with certbot's webroot method, without needing to
   stop nginx:
   ```bash
   docker run --rm \
     -v cadonline_certbot-www:/var/www/certbot \
     -v cadonline_certbot-etc:/etc/letsencrypt \
     certbot/certbot certonly --webroot -w /var/www/certbot \
     -d your-domain.com --email you@example.com --agree-tos --no-eff-email
   ```
   This drops the cert at `/etc/letsencrypt/live/your-domain.com/`, matching
   the paths in `nginx.ssl.conf`.

4. **Switch the Dockerfile** to ship the TLS config instead of the plain one:
   ```dockerfile
   COPY nginx.ssl.conf /etc/nginx/conf.d/default.conf
   COPY nginx.common.conf /etc/nginx/common.conf
   ```
   (leave `nginx.conf` as-is in the repo — it's what `certbot certonly`
   above needs to be running against during step 3, before this swap.)

5. **Update `docker-compose.prod.yml`**: publish `443:443` (keep `80:80` for
   the ACME challenge + HTTP→HTTPS redirect), and mount the two volumes used
   above (`certbot-etc` → `/etc/letsencrypt`, `certbot-www` → the webroot
   nginx serves `/.well-known/acme-challenge/` from) into the `web` service.

6. **Renewal**: certificates expire every 90 days. Add a host cron (or a
   `certbot/certbot renew` sidecar container on a weekly timer) running the
   same `certonly` command with `renew` in place of `certonly`, then
   `docker compose exec web nginx -s reload` so nginx picks up the new cert
   without downtime.

## Why this isn't wired up by default

Steps 1–3 need a real domain and DNS control this repo doesn't have — there's
nothing to automate until that exists. Everything else (the CSP header, the
ACME challenge location block, the ready-to-edit `nginx.ssl.conf`) is already
in place so this is a config edit + one certbot run, not a code change.
