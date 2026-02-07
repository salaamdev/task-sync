import http from 'node:http';
import { once } from 'node:events';

const port = Number(process.env.TASK_SYNC_GOOGLE_OAUTH_PORT ?? 53682);
const redirectUri = `http://localhost:${port}/callback`;

const clientId = process.env.TASK_SYNC_GOOGLE_CLIENT_ID;
const clientSecret = process.env.TASK_SYNC_GOOGLE_CLIENT_SECRET;

if (!clientId || !clientSecret) {
  console.error('Missing env vars: TASK_SYNC_GOOGLE_CLIENT_ID, TASK_SYNC_GOOGLE_CLIENT_SECRET');
  process.exit(2);
}

const scopes = ['https://www.googleapis.com/auth/tasks'];

const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', clientId);
authUrl.searchParams.set('redirect_uri', redirectUri);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', scopes.join(' '));
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
  token_type: string;
};

async function exchange(code: string): Promise<TokenResponse> {
  const body = new URLSearchParams({
    code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Token exchange failed: HTTP ${res.status} ${txt}`);
  }

  return (await res.json()) as TokenResponse;
}

async function main() {
  console.log('Google OAuth (Installed app) refresh-token helper');
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

        if (!token.refresh_token) {
          console.log(
            '\nNOTE: No refresh_token returned. Common fixes: remove prior consent in Google Account security, then re-run; ensure prompt=consent + access_type=offline.',
          );
        }

        console.log('\n3) Set env vars:');
        if (token.refresh_token) console.log(`TASK_SYNC_GOOGLE_REFRESH_TOKEN=${token.refresh_token}`);

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
