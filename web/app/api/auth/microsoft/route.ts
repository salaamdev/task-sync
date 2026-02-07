import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/env';

export async function GET(request: NextRequest) {
  const config = getConfig();

  if (!config.msClientId) {
    return NextResponse.json(
      { error: 'Microsoft OAuth not configured. Set TASK_SYNC_MS_CLIENT_ID.' },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/microsoft/callback`;

  const scopes = [
    'offline_access',
    'https://graph.microsoft.com/User.Read',
    'https://graph.microsoft.com/Tasks.ReadWrite',
  ];

  const authUrl = new URL(
    `https://login.microsoftonline.com/${encodeURIComponent(config.msTenantId)}/oauth2/v2.0/authorize`,
  );
  authUrl.searchParams.set('client_id', config.msClientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('response_mode', 'query');
  authUrl.searchParams.set('scope', scopes.join(' '));

  return NextResponse.redirect(authUrl.toString());
}
