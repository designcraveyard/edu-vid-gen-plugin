#!/usr/bin/env node
/**
 * Launch the timeline editor for a project folder
 * Usage: node editor/start.mjs --project ./food-chain-20260326-211306
 */
import { execSync, spawn } from 'child_process';
import { existsSync, statSync, createReadStream } from 'fs';
import { resolve, extname } from 'path';
import { createServer } from 'http';

const args = process.argv.slice(2);
const get = (flag, def = null) => { const i = args.indexOf(flag); return i !== -1 ? args[i + 1] : def; };

const projectDir = get('--project');
if (!projectDir) {
  console.error('Usage: node editor/start.mjs --project <path-to-video-project>');
  process.exit(1);
}

const absDir = resolve(projectDir);
if (!existsSync(absDir)) {
  console.error(`Project directory not found: ${absDir}`);
  process.exit(1);
}
if (!existsSync(`${absDir}/audio/timeline.json`)) {
  console.error(`Not a valid video project (missing audio/timeline.json): ${absDir}`);
  process.exit(1);
}
if (!existsSync(`${absDir}/metadata.json`)) {
  console.log(`  Note: metadata.json not found — editor will synthesize from timeline.json`);
}

const port = 3333;
const mediaPort = 3334;

// ── Media file server (lightweight, supports range requests for video) ──────
const MIME = { '.mp4': 'video/mp4', '.mp3': 'audio/mpeg', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };

const mediaServer = createServer((req, res) => {
  // CORS headers for Next.js app
  res.setHeader('Access-Control-Allow-Origin', `http://localhost:${port}`);
  res.setHeader('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Range');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, Accept-Ranges, Content-Length');

  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  const filePath = resolve(absDir, decodeURIComponent(req.url.slice(1)));
  if (!filePath.startsWith(absDir) || !existsSync(filePath)) {
    res.writeHead(404); res.end('Not found'); return;
  }

  const stat = statSync(filePath);
  const ext = extname(filePath).toLowerCase();
  const contentType = MIME[ext] || 'application/octet-stream';

  const range = req.headers.range;
  if (range) {
    const parts = range.replace(/bytes=/, '').split('-');
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${stat.size}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'no-cache',
    });
    createReadStream(filePath).pipe(res);
  }
});

mediaServer.listen(mediaPort, () => {
  console.log(`  Media server: http://localhost:${mediaPort}/`);
});

// ── Symlink project into public/ for static file serving ────────────────────
const editorDir = decodeURIComponent(new URL('.', import.meta.url).pathname);
const publicDir = resolve(editorDir, 'public');
const symlinkPath = resolve(publicDir, 'project');
import { mkdirSync, unlinkSync, symlinkSync } from 'fs';
try { mkdirSync(publicDir, { recursive: true }); } catch {}
try { unlinkSync(symlinkPath); } catch {}
symlinkSync(absDir, symlinkPath);
console.log(`  Symlink: public/project → ${absDir}`);

// ── Next.js app ─────────────────────────────────────────────────────────────
const url = `http://localhost:${port}?project=${encodeURIComponent(absDir)}`;

console.log(`\nTimeline Editor`);
console.log(`  Project: ${absDir}`);
console.log(`  App: ${url}`);
if (!existsSync(`${editorDir}/node_modules`)) {
  console.log('Installing dependencies...');
  execSync('npm install', { cwd: editorDir, stdio: 'inherit' });
}

// Pass media port and project dir as env vars so the Next.js app knows where to find media
const next = spawn('npx', ['next', 'dev', '--port', String(port)], {
  cwd: editorDir,
  stdio: 'inherit',
  env: { ...process.env, NEXT_PUBLIC_MEDIA_PORT: String(mediaPort), NEXT_PUBLIC_PROJECT_DIR: absDir },
});

setTimeout(() => {
  try { execSync(`open "${url}"`); } catch { console.log(`Open in browser: ${url}`); }
}, 3000);

next.on('close', (code) => { mediaServer.close(); process.exit(code ?? 0); });
process.on('SIGINT', () => { next.kill(); mediaServer.close(); process.exit(0); });
