import http from 'node:http';
import { once } from 'node:events';

const port = Number(process.env.TASK_SYNC_MS_OAUTH_PORT ?? 53683);
const redirectUri = `http://localhost:${port}/callback`;

const clientId = process.env.TASK_SYNC_MS_CLIENT_ID;
const tenantId = process.env.TASK_SYNC_MS_TENANT_ID ?? 'common';

if (!clientId) {
  console.error('Missing env var: TASK_SYNC_MS_CLIENT_ID');
  process.exit(2);
}

// Use Microsoft Graph resource scopes (required for consumer accounts and avoids ambiguous scope errors)
const scopes = [
  'offline_access',
  'https://graph.microsoft.com/User.Read',
  'https://graph.microsoft.com/Tasks.ReadWrite',
];

const authUrl = new URL(`https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`);
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('response_mode', 'query');
authUrl.searchParams.set('scope', scopes.join(' '));

type TokenResponse = {
  token_type: string;
  scope: string;
  expires_in: number;
  ext_expires_in: number;
  access_token: string;
  refresh_token?: string;
};

async function exchange(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    client_id: clientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Token exchange failed: HTTP ${res.status} ${txt}`);
  }

  return (await res.json()) as TokenResponse;
}

async function main() {
  console.log('Microsoft OAuth (Installed app) refresh-token helper');
  console.log('Redirect URI:', redirectUri);
  console.log('\n1) Open this URL in your browser and consent:');
  console.log(authUrl.toString());

  const server = http
    .createServer(async (req, res) => {
      try {
        const u = new URL(req.url ?? '/', `http://localhost:${port}`);
        if (u.pathname !== '/callback') {
          res.writeHead(404);
          res.end('Not found');
          return;
        }

        const code = u.searchParams.get('code');
        const err = u.searchParams.get('error');
        if (err) {
          res.writeHead(400);
          res.end(`OAuth error: ${err}`);
          return;
        }
        if (!code) {
          res.writeHead(400);
          res.end('Missing code');
          return;
        }

        const token = await exchange(code);

        res.writeHead(200, { 'content-type': 'text/plain' });
        res.end('Done. You can close this tab and go back to your terminal.');

        console.log('\n2) Tokens received:');
        console.log('- access_token:', token.access_token);
        console.log('- refresh_token:', token.refresh_token ?? '(missing)');

        console.log('\n3) Set env vars:');
        if (token.refresh_token) console.log(`TASK_SYNC_MS_REFRESH_TOKEN=${token.refresh_token}`);

        server.close();
      } catch (e) {
        res.writeHead(500);
        res.end('Internal error');
        console.error(e);
        server.close();
        process.exitCode = 1;
      }
    })
    .listen(port);

  await once(server, 'listening');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
