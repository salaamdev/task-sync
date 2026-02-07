import { NextRequest, NextResponse } from 'next/server';
import { deleteProviderToken } from '@/lib/tokens';

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ provider: string }> },
) {
  const { provider } = await params;

  if (provider !== 'google' && provider !== 'microsoft') {
    return NextResponse.json({ error: 'Invalid provider' }, { status: 400 });
  }

  await deleteProviderToken(provider);
  return NextResponse.json({ ok: true });
}
