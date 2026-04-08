import { NextRequest, NextResponse } from 'next/server';
import { writeFileSync } from 'fs';
import { join } from 'path';
import type { EditedTimeline } from '@/lib/types';

export async function POST(request: NextRequest) {
  try {
    const timeline: EditedTimeline = await request.json();
    const outputPath = join(timeline.projectDir, 'edited-timeline.json');
    writeFileSync(outputPath, JSON.stringify(timeline, null, 2));
    return NextResponse.json({ path: outputPath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
