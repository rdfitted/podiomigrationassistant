@echo off
echo Starting LocalTunnel with subdomain: podio-migration-agent
echo.
echo URL: https://podio-migration-agent.loca.lt
echo.
echo Make sure to configure Podio redirect URI to:
echo https://podio-migration-agent.loca.lt/api/auth/podio/callback
echo.
echo Press Ctrl+C to stop the tunnel
echo.
lt --port 3000 --subdomain podio-migration-agent
