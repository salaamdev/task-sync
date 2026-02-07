import { NextRequest, NextResponse } from 'next/server';
import { getConfig } from '@/lib/env';

export async function GET(request: NextRequest) {
  const config = getConfig();

  if (!config.googleClientId || !config.googleClientSecret) {
    return NextResponse.json(
      { error: 'Google OAuth not configured. Set TASK_SYNC_GOOGLE_CLIENT_ID and TASK_SYNC_GOOGLE_CLIENT_SECRET.' },
      { status: 400 },
    );
  }

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/auth/google/callback`;

  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authUrl.searchParams.set('client_id', config.googleClientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('scope', 'https://www.googleapis.com/auth/tasks');
  authUrl.searchParams.set('access_type', 'offline');
  authUrl.searchParams.set('prompt', 'consent');

  return NextResponse.redirect(authUrl.toString());
}
