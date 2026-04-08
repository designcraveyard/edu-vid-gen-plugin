import { NextRequest, NextResponse } from 'next/server';
import { renderFromEditedTimeline } from '@/lib/ffmpeg-render';

export async function POST(request: NextRequest) {
  try {
    const { projectDir } = await request.json();
    if (!projectDir) {
      return NextResponse.json({ error: 'Missing projectDir' }, { status: 400 });
    }
    const outputPath = renderFromEditedTimeline(projectDir);
    return NextResponse.json({ path: outputPath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
