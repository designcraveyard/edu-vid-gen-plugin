import { NextRequest, NextResponse } from 'next/server';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import type { EditedTimeline } from '@/lib/types';
import { generateFCP7XML } from '@/lib/export-fcp7xml';

export async function POST(request: NextRequest) {
  try {
    const { projectDir } = await request.json();
    const timelinePath = join(projectDir, 'edited-timeline.json');
    if (!existsSync(timelinePath)) {
      return NextResponse.json(
        { error: 'edited-timeline.json not found. Save first.' },
        { status: 400 }
      );
    }
    const timeline: EditedTimeline = JSON.parse(readFileSync(timelinePath, 'utf-8'));
    const xml = generateFCP7XML(timeline);
    const exportDir = join(projectDir, 'export');
    if (!existsSync(exportDir)) mkdirSync(exportDir, { recursive: true });
    const outputPath = join(exportDir, 'project.xml');
    writeFileSync(outputPath, xml);
    return NextResponse.json({ path: outputPath });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
