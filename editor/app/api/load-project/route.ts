import { NextRequest, NextResponse } from 'next/server';
import { loadProject } from '@/lib/load-project';

export async function GET(request: NextRequest) {
  const projectDir = request.nextUrl.searchParams.get('dir');
  if (!projectDir) {
    return NextResponse.json({ error: 'Missing ?dir= parameter' }, { status: 400 });
  }
  try {
    const data = loadProject(projectDir);
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
