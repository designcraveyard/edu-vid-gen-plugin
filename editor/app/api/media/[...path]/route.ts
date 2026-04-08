import { NextRequest, NextResponse } from 'next/server';
import { existsSync, statSync, readFileSync } from 'fs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path } = await params;
  const filePath = '/' + path.join('/');

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 });
  }

  const stat = statSync(filePath);
  const ext = filePath.split('.').pop()?.toLowerCase();
  const contentType = ext === 'mp4' ? 'video/mp4'
    : ext === 'mp3' ? 'audio/mpeg'
    : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
    : ext === 'png' ? 'image/png'
    : 'application/octet-stream';

  const range = request.headers.get('range');
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : Math.min(start + 1024 * 1024 - 1, stat.size - 1);
    const chunkSize = end - start + 1;

    const buf = Buffer.alloc(chunkSize);
    const fd = require('fs').openSync(filePath, 'r');
    require('fs').readSync(fd, buf, 0, chunkSize, start);
    require('fs').closeSync(fd);

    return new NextResponse(buf, {
      status: 206,
      headers: {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': String(chunkSize),
        'Content-Type': contentType,
      },
    });
  }

  // Full file — read entire buffer
  const buffer = readFileSync(filePath);
  return new NextResponse(buffer, {
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
    },
  });
}
