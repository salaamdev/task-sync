import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/env';
import { saveProviderToken } from '@/lib/tokens';

export async function GET(request: NextRequest) {
  const config = getConfig();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`${url.origin}/?error=microsoft_${error}`);
  }

  if (!code) {
    return NextResponse.redirect(`${url.origin}/?error=microsoft_missing_code`);
  }

  const redirectUri = `${url.origin}/api/auth/microsoft/callback`;

  const scopes = [
    'offline_access',
    'https://graph.microsoft.com/User.Read',
    'https://graph.microsoft.com/Tasks.ReadWrite',
  ];

  const body = new URLSearchParams({
    client_id: config.msClientId,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    scope: scopes.join(' '),
  });

  // Confidential clients (web apps) require client_secret for token exchange.
  if (config.msClientSecret) body.set('client_secret', config.msClientSecret);

  const res = await fetch(
    `https://login.microsoftonline.com/${encodeURIComponent(config.msTenantId)}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    },
  );

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    console.error('Microsoft token exchange failed:', res.status, txt);
    return NextResponse.redirect(`${url.origin}/?error=microsoft_token_exchange`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  if (!json.refresh_token) {
    console.error('Microsoft did not return a refresh_token. Ensure offline_access scope is requested.');
    return NextResponse.redirect(`${url.origin}/?error=microsoft_no_refresh_token`);
  }

  await saveProviderToken('microsoft', {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  });

  return NextResponse.redirect(`${url.origin}/?connected=microsoft`);
}
