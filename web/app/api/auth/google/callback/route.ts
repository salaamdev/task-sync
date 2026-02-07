import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/env';
import { saveProviderToken } from '@/lib/tokens';

export async function GET(request: NextRequest) {
  const config = getConfig();
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    return NextResponse.redirect(`${url.origin}/?error=google_${error}`);
  }

  if (!code) {
    return NextResponse.redirect(`${url.origin}/?error=google_missing_code`);
  }

  const redirectUri = `${url.origin}/api/auth/google/callback`;

  const body = new URLSearchParams({
    code,
    client_id: config.googleClientId,
    client_secret: config.googleClientSecret,
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
    console.error('Google token exchange failed:', res.status, txt);
    return NextResponse.redirect(`${url.origin}/?error=google_token_exchange`);
  }

  const json = (await res.json()) as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
  };

  if (!json.refresh_token) {
    console.error('Google did not return a refresh_token. Ensure prompt=consent and access_type=offline.');
    return NextResponse.redirect(`${url.origin}/?error=google_no_refresh_token`);
  }

  await saveProviderToken('google', {
    refreshToken: json.refresh_token,
    accessToken: json.access_token,
    expiresAt: Date.now() + json.expires_in * 1000,
  });

  return NextResponse.redirect(`${url.origin}/?connected=google`);
}
