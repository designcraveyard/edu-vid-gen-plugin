#!/usr/bin/env python3
"""
generate-subtitle-video.py

Creates a karaoke-style subtitle video from ElevenLabs character timestamps.
Each word lights up (yellow) as it is spoken; other words are dimmed.
Rendered entirely with PIL — no libass required.

Modes:
  1. Black background (default):
     python3 generate-subtitle-video.py --timestamps t.json --audio vo.mp3 --output out.mp4

  2. Overlay on existing video (for sync verification):
     python3 generate-subtitle-video.py --timestamps t.json --audio vo.mp3 \
         --video clip.mp4 --clip-start 79.98 --clip-end 87.49 --output verify.mp4
"""

import argparse, json, subprocess, sys, os
from PIL import Image, ImageDraw, ImageFont

# ── CLI ───────────────────────────────────────────────────────────────────────
p = argparse.ArgumentParser()
p.add_argument('--timestamps',     required=True)
p.add_argument('--audio',          required=True)
p.add_argument('--output',         default='subtitles-video.mp4')
p.add_argument('--words-per-line', type=int, default=8)
p.add_argument('--fps',            type=int, default=30)
p.add_argument('--width',          type=int, default=1920)
p.add_argument('--height',         type=int, default=1080)
# Overlay mode
p.add_argument('--video',          default=None, help='Overlay subtitles on this video instead of black bg')
p.add_argument('--clip-start',     type=float, default=None, help='VO start time (seconds) in full-vo for this clip')
p.add_argument('--clip-end',       type=float, default=None, help='VO end time (seconds) in full-vo for this clip')
args = p.parse_args()

OVERLAY_MODE = args.video is not None
W, H, FPS = args.width, args.height, args.fps
WORDS_PER_LINE = args.words_per_line

# ── Load timestamps → word list ───────────────────────────────────────────────
print("Loading timestamps...")
with open(args.timestamps) as f:
    data = json.load(f)

chars  = data['characters']
starts = data['character_start_times_seconds']
ends   = data['character_end_times_seconds']

words = []
buf, ws, we = [], None, None
for i, ch in enumerate(chars):
    if ch in (' ', '\n', '\r'):
        if buf:
            words.append({'text': ''.join(buf), 'start': ws, 'end': we})
            buf, ws, we = [], None, None
    else:
        if ws is None: ws = starts[i]
        we = ends[i]
        buf.append(ch)
if buf:
    words.append({'text': ''.join(buf), 'start': ws, 'end': we})

print(f"  {len(words)} words parsed")

# ── In overlay mode, filter words to clip window and rebase timestamps ────────
if OVERLAY_MODE and args.clip_start is not None:
    clip_s, clip_e = args.clip_start, args.clip_end or words[-1]['end']
    words = [w for w in words if w['end'] >= clip_s and w['start'] <= clip_e]
    # Rebase to clip-relative time (0 = clip start)
    for w in words:
        w['start'] = max(0, w['start'] - clip_s)
        w['end']   = w['end'] - clip_s
    print(f"  Filtered to clip window: {clip_s:.2f}-{clip_e:.2f} → {len(words)} words")

# ── Group into lines ──────────────────────────────────────────────────────────
lines = []
for i in range(0, len(words), WORDS_PER_LINE):
    chunk = words[i:i + WORDS_PER_LINE]
    lines.append({'words': chunk, 'start': chunk[0]['start'], 'end': chunk[-1]['end'] + 0.4})

print(f"  {len(lines)} subtitle lines")

# ── Duration & audio source ───────────────────────────────────────────────────
import tempfile, atexit

if OVERLAY_MODE:
    # Duration comes from the video file, not the full audio
    dur_raw = subprocess.check_output(
        ['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
         '-of', 'csv=p=0', args.video]
    ).decode().strip()
    DURATION = float(dur_raw)

    # In overlay mode: extract clip-window audio from full VO and use it
    _tmp_wav = tempfile.mktemp(suffix='.wav')
    atexit.register(lambda: os.path.exists(_tmp_wav) and os.remove(_tmp_wav))
    clip_s = args.clip_start or 0
    subprocess.check_call(
        ['ffmpeg', '-y', '-i', args.audio,
         '-ss', str(clip_s), '-t', str(DURATION),
         '-c:a', 'pcm_s16le', _tmp_wav],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    AUDIO_INPUT = _tmp_wav

    # Get video dimensions
    dims = subprocess.check_output(
        ['ffprobe', '-v', 'quiet', '-select_streams', 'v:0',
         '-show_entries', 'stream=width,height',
         '-of', 'csv=p=0', args.video]
    ).decode().strip().split(',')
    W, H = int(dims[0]), int(dims[1])

    # Get video FPS
    fps_raw = subprocess.check_output(
        ['ffprobe', '-v', 'quiet', '-select_streams', 'v:0',
         '-show_entries', 'stream=r_frame_rate',
         '-of', 'csv=p=0', args.video]
    ).decode().strip()
    num, den = fps_raw.split('/')
    FPS = round(int(num) / int(den))

    print(f"  Overlay mode: {W}x{H} @ {FPS}fps, {DURATION:.1f}s")
else:
    dur_raw = subprocess.check_output(
        ['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration',
         '-of', 'csv=p=0', args.audio]
    ).decode().strip()
    DURATION = float(dur_raw)

    _tmp_wav = tempfile.mktemp(suffix='.wav')
    atexit.register(lambda: os.path.exists(_tmp_wav) and os.remove(_tmp_wav))
    print(f"  Normalising audio → {_tmp_wav}")
    subprocess.check_call(
        ['ffmpeg', '-y', '-i', args.audio, '-c:a', 'pcm_s16le', _tmp_wav],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
    )
    AUDIO_INPUT = _tmp_wav

TOTAL_FRAMES = int(DURATION * FPS) + 1
print(f"  {DURATION:.1f}s → {TOTAL_FRAMES} frames @ {FPS}fps")

# ── Font setup ────────────────────────────────────────────────────────────────
FONT_SIZE    = 72
LINE_SPACING = 20  # px between lines of text
BOTTOM_PAD   = 120 # px from bottom

def load_font(size):
    candidates = [
        '/System/Library/Fonts/Helvetica.ttc',
        '/System/Library/Fonts/Arial.ttf',
        '/Library/Fonts/Arial.ttf',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
        '/usr/share/fonts/truetype/freefont/FreeSans.ttf',
    ]
    for path in candidates:
        if os.path.exists(path):
            try: return ImageFont.truetype(path, size)
            except: pass
    return ImageFont.load_default()

FONT = load_font(FONT_SIZE)

# Colors
COL_BG      = (0,   0,   0)      # black background
COL_ACTIVE  = (255, 230, 60)     # yellow — currently spoken word
COL_PAST    = (220, 220, 220)    # light gray — already spoken
COL_FUTURE  = (80,  80,  80)     # dark gray  — not yet spoken (black bg)
if OVERLAY_MODE:
    COL_PAST   = (255, 255, 255) # white on video (already spoken)
    COL_FUTURE = (150, 150, 150) # mid-gray on video (upcoming)
BAND_HEIGHT = FONT_SIZE + BOTTOM_PAD + 20  # semi-transparent strip height

# ── Build active-line index for fast lookup ───────────────────────────────────
# For each line, find the active word at a given time
def get_line_at(t):
    """Return the latest line whose start <= t. Returns None before first line."""
    result = None
    for line in lines:
        if line['start'] <= t:
            result = line
        else:
            break
    return result

def active_word_idx(line, t):
    """Index of currently spoken word in line at time t."""
    for i, w in enumerate(line['words']):
        if w['start'] <= t <= w['end']:
            return i
    # Between words — find previous
    for i in range(len(line['words']) - 1, -1, -1):
        if line['words'][i]['end'] <= t:
            return i + 1  # next upcoming word
    return 0

# ── Render a frame ────────────────────────────────────────────────────────────
def render_frame(t, base_img=None):
    if base_img:
        img = base_img.copy()
    else:
        img = Image.new('RGB', (W, H), COL_BG)

    line = get_line_at(t)
    if line is None or t > line['end']:
        return img

    # In overlay mode, draw semi-transparent dark band at the bottom
    if base_img:
        overlay = Image.new('RGBA', (W, H), (0, 0, 0, 0))
        overlay_draw = ImageDraw.Draw(overlay)
        band_top = H - BAND_HEIGHT
        overlay_draw.rectangle([(0, band_top), (W, H)], fill=(0, 0, 0, 160))
        img = img.convert('RGBA')
        img = Image.alpha_composite(img, overlay)
        img = img.convert('RGB')

    draw = ImageDraw.Draw(img)

    # Build colored word segments
    wds = line['words']
    aidx = active_word_idx(line, t)

    # Measure each word to compute total line width
    segments = []
    total_w = 0
    for i, w in enumerate(wds):
        text = w['text']
        bbox = FONT.getbbox(text)
        tw = bbox[2] - bbox[0]
        if i < aidx:          col = COL_PAST
        elif i == aidx:       col = COL_ACTIVE
        else:                 col = COL_FUTURE
        space_w = FONT.getbbox(' ')[2] - FONT.getbbox(' ')[0] if i < len(wds) - 1 else 0
        segments.append({'text': text, 'color': col, 'w': tw, 'sw': space_w})
        total_w += tw + space_w

    # Center horizontally; place at bottom
    x = (W - total_w) // 2
    y = H - BOTTOM_PAD - FONT_SIZE

    for seg in segments:
        draw.text((x, y), seg['text'], font=FONT, fill=seg['color'])
        x += seg['w'] + seg['sw']

    return img

# ── Video frame reader (overlay mode) ─────────────────────────────────────────
video_reader = None
if OVERLAY_MODE:
    # Decode video to raw RGB frames via ffmpeg pipe
    video_reader = subprocess.Popen(
        ['ffmpeg', '-i', args.video,
         '-f', 'rawvideo', '-pix_fmt', 'rgb24',
         '-v', 'quiet', '-'],
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL
    )
    FRAME_BYTES = W * H * 3

# ── Pipe frames to ffmpeg ─────────────────────────────────────────────────────
ffmpeg_cmd = [
    'ffmpeg', '-y',
    '-f', 'rawvideo',
    '-vcodec', 'rawvideo',
    '-s', f'{W}x{H}',
    '-pix_fmt', 'rgb24',
    '-r', str(FPS),
    '-i', 'pipe:0',
    '-i', AUDIO_INPUT,
    '-c:v', 'libx264',
    '-preset', 'fast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-c:a', 'aac',
    '-b:a', '192k',
    '-t', str(DURATION),
    args.output,
]

print(f"\nRendering {TOTAL_FRAMES} frames → {args.output}")
proc = subprocess.Popen(ffmpeg_cmd, stdin=subprocess.PIPE, stderr=subprocess.PIPE)

try:
    for frame_num in range(TOTAL_FRAMES):
        t = frame_num / FPS

        base_img = None
        if video_reader:
            raw = video_reader.stdout.read(FRAME_BYTES)
            if len(raw) == FRAME_BYTES:
                base_img = Image.frombytes('RGB', (W, H), raw)

        img = render_frame(t, base_img)
        proc.stdin.write(img.tobytes())

        if frame_num % (FPS * 10) == 0:
            pct = frame_num / TOTAL_FRAMES * 100
            print(f"  {pct:.0f}%  t={t:.1f}s", flush=True)

    proc.stdin.close()
    _, stderr_data = proc.communicate()
    if proc.returncode != 0:
        sys.stderr.write(stderr_data.decode(errors='replace'))
except BrokenPipeError:
    sys.stderr.write("ffmpeg pipe closed early\n")
    _, stderr_data = proc.communicate()
    sys.stderr.write(stderr_data.decode(errors='replace'))

if video_reader:
    video_reader.terminate()

if proc.returncode != 0:
    sys.exit(f"ffmpeg exited with code {proc.returncode}")

print(f"\nDone! → {args.output}")
