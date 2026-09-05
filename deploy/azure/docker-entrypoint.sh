#!/bin/sh
# Renders nginx config from templates at container start, then execs nginx.
#
# envsubst is given an explicit allowlist: a bare `envsubst` would also expand
# nginx's own $host, $remote_addr and $proxy_add_x_forwarded_for, blanking the
# forwarded headers.
set -eu

: "${API_ORIGIN:?API_ORIGIN must be set (e.g. https://cado-api.internal.<region>.azurecontainerapps.io)}"

# Strip a trailing slash: proxy_pass treats "https://host/" as a URI replacement
# (dropping the /api/ prefix) while "https://host" preserves the full path.
API_ORIGIN="${API_ORIGIN%/}"
export API_ORIGIN

envsubst '${API_ORIGIN}' < /etc/nginx/templates/common.conf.template  > /etc/nginx/common.conf
envsubst '${API_ORIGIN}' < /etc/nginx/templates/default.conf.template > /etc/nginx/conf.d/default.conf

nginx -t
exec nginx -g 'daemon off;'
