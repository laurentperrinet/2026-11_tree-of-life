#!/usr/bin/env python3
"""Local server for the admin timelapse, usable from Safari.

Safari blocks requests from an HTTPS page (GitHub Pages) to ``http://localhost``
as mixed content, so the page cannot hand its frames to a local program. This
server therefore serves the page itself, from this repository, at
``http://localhost:8765/?admin``; the page then sends each frame to the same
origin. It also relays ``/api/*`` to the collaboration Worker, server to server,
so the recorded simulation keeps receiving the shared terrain.

Endpoints:
    GET  /, /index.html, /css/*, /js/*   static files of the repository (nothing else)
    GET  /version.json                   {"commit": "<git HEAD>[-dirty]"}
    GET  /api/timelapse/status           {"next": "000343.png", "folder": "<path>", "video": {...}}
    POST /api/timelapse/frame            PNG body; saved as the next NNNNNN.png
    POST /api/timelapse/stop             encode the frames into <folder>.mp4 with ffmpeg
    *    /api/...                        relayed to the Worker

Usage:
    python3 tools/timelapse_server.py [--port 8765] [--out timelapse] [--fps 30]

Only the standard library is used. The server listens on 127.0.0.1 only.
"""

from __future__ import annotations

import argparse
import json
import os
import posixpath
import re
import shutil
import socketserver
import subprocess
import tempfile
import threading
import urllib.error
import urllib.parse
import urllib.request
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
WORKER = 'https://tree-of-life.laurent-perrinet.workers.dev'
PNG_SIGNATURE = b'\x89PNG\r\n\x1a\n'
FRAME_NAME = re.compile(r'^(\d{6})\.png$')
MAX_FRAME_BYTES = 64 * 1024 * 1024  # a 1920 × 1080 frame is 1–3 MB
MAX_FRAMES = 999_999                # six digits
STATIC_PREFIXES = ('/css/', '/js/')
# Request headers the Worker reads; Origin is deliberately not relayed (see relay()).
# User-Agent is relayed too: Cloudflare rejects urllib's default one (error 1010).
RELAYED_HEADERS = ('Content-Type', 'Authorization', 'X-Collaborator-ID', 'X-Terrain-Version',
                   'X-Payload-Encoding', 'X-Mesh-Signature', 'User-Agent')
FALLBACK_USER_AGENT = 'tree-of-life-timelapse-server/1.0'


def frame_name(index: int) -> str:
    """Six-digit frame file name: 342 gives ``000342.png``.

    Args:
        index: Frame number, from 1 to 999999.
    """
    if not 1 <= index <= MAX_FRAMES:
        raise ValueError(f'frame number out of range: {index}')
    return f'{index:06d}.png'


def next_index(folder: Path) -> int:
    """Number following the highest frame in ``folder``, so that a new recording
    appends to the sequence instead of overwriting it.

    Args:
        folder: Timelapse folder (may not exist yet).
    """
    return max(frame_numbers(folder), default=0) + 1


def git_commit(repo: Path = REPO) -> str:
    """Commit of the served files: HEAD, with ``-dirty`` if tracked files differ.

    Args:
        repo: Repository root.
    """
    try:
        head = subprocess.run(['git', 'rev-parse', 'HEAD'], cwd=repo, check=True,
                              capture_output=True, text=True).stdout.strip()
        # Untracked files (the timelapse folder itself, notes) do not change the page.
        dirty = subprocess.run(['git', 'status', '--porcelain', '--untracked-files=no'],
                               cwd=repo, check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        return 'unknown'
    return f'{head}-dirty' if dirty else head


class FrameStore:
    """Numbered PNG frames in one folder, written atomically.

    A lock serialises numbering and writing, so two concurrent requests (two tabs)
    never get the same number.
    """

    def __init__(self, folder: Path):
        self.folder = folder
        self.lock = threading.Lock()

    def peek(self) -> str:
        with self.lock:
            return frame_name(next_index(self.folder))

    def save(self, png: bytes) -> str:
        """Write ``png`` as the next frame and return its file name.

        The bytes go to a temporary file in the same folder, then ``os.replace``
        renames it: a frame interrupted by a crash never appears under its final
        name, and the numbering (which only counts final names) stays dense.

        Args:
            png: Complete PNG file.
        """
        if not png.startswith(PNG_SIGNATURE):
            raise ValueError('body is not a PNG file')
        with self.lock:
            self.folder.mkdir(parents=True, exist_ok=True)
            name = frame_name(next_index(self.folder))
            fd, tmp = tempfile.mkstemp(dir=self.folder, prefix='.', suffix='.png.tmp')
            try:
                with os.fdopen(fd, 'wb') as file:
                    file.write(png)
                os.replace(tmp, self.folder / name)
            except BaseException:
                Path(tmp).unlink(missing_ok=True)
                raise
            return name


def frame_numbers(folder: Path) -> list[int]:
    """Sorted numbers of the frames in ``folder``.

    Args:
        folder: Timelapse folder (may not exist yet).
    """
    if not folder.is_dir():
        return []
    return sorted(int(m.group(1)) for p in folder.iterdir() if (m := FRAME_NAME.match(p.name)))


def ffmpeg_command(folder: Path, output: Path, fps: float, start: int,
                   ffmpeg: str = 'ffmpeg') -> list[str]:
    """``ffmpeg -framerate 30 -i timelapse/%06d.png -pix_fmt yuv420p timelapse.mp4``,
    made safe to run unattended.

    ``-y`` overwrites without asking (the prompt would wait forever on a server),
    ``-start_number`` lets the sequence start above 4 (ffmpeg only probes 0–4), and
    ``-f mp4`` names the format, since ``output`` is a temporary file.

    Args:
        folder: Folder of NNNNNN.png frames.
        output: Video file to write.
        fps: Frame rate of the video (frames/s); one frame is one wall-clock second.
        start: Number of the first frame.
        ffmpeg: ffmpeg executable.
    """
    return [ffmpeg, '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-framerate', f'{fps:g}', '-start_number', str(start),
            '-i', str(folder / '%06d.png'), '-pix_fmt', 'yuv420p', '-f', 'mp4', str(output)]


class VideoEncoder:
    """Turns the frame folder into ``<folder>.mp4`` in a background thread.

    A request during an encoding is remembered and runs once it finishes, so the
    video always ends up covering the latest frames.
    """

    def __init__(self, folder: Path, fps: float = 30):
        self.folder = folder
        self.output = folder.parent / f'{folder.name}.mp4'
        self.fps = fps
        self.lock = threading.Lock()
        self.thread = None
        self.again = False
        self.status = {'state': 'idle', 'path': str(self.output)}

    def snapshot(self) -> dict:
        with self.lock:
            return dict(self.status)

    def request(self) -> dict:
        """Start an encoding, or queue one if an encoding is running."""
        with self.lock:
            if self.thread and self.thread.is_alive():
                self.again = True
            else:
                self.status = {'state': 'encoding', 'path': str(self.output)}
                self.thread = threading.Thread(target=self.run, daemon=True)
                self.thread.start()
            return dict(self.status)

    def run(self):
        while True:
            status = self.encode()
            with self.lock:
                if not self.again:
                    self.status = status
                    # A custom encoder may report a minimal status; the print must
                    # never crash the daemon thread, so read fields defensively.
                    if status['state'] == 'done':
                        detail = []
                        frames = status.get('frames')
                        seconds = status.get('seconds')
                        if frames is not None:
                            detail.append(f"{frames} frames")
                        if seconds is not None:
                            detail.append(f"{seconds:.1f} s")
                        print(f"Video: {status.get('path', self.output)} ({', '.join(detail) or 'done'})",
                              flush=True)
                    else:
                        print(f"Video not made: {status.get('message', 'unknown error')}", flush=True)
                    return
                self.again = False
                self.status = {'state': 'encoding', 'path': str(self.output)}

    def encode(self) -> dict:
        """Run ffmpeg once; return the resulting status."""
        result = {'path': str(self.output)}
        ffmpeg = shutil.which('ffmpeg')
        if not ffmpeg:
            return {**result, 'state': 'error', 'message': 'ffmpeg not found (brew install ffmpeg)'}
        numbers = frame_numbers(self.folder)
        if not numbers:
            return {**result, 'state': 'error', 'message': f'no frames in {self.folder}'}
        # ffmpeg stops at the first missing number: say how many frames it will take.
        frames = next((i for i, n in enumerate(numbers) if n != numbers[0] + i), len(numbers))
        tmp = self.output.with_name(f'.{self.output.name}.tmp')
        process = subprocess.run(ffmpeg_command(self.folder, tmp, self.fps, numbers[0], ffmpeg),
                                 capture_output=True, text=True)
        if process.returncode != 0:
            tmp.unlink(missing_ok=True)
            message = process.stderr.strip().splitlines()[-1:] or [f'exit code {process.returncode}']
            return {**result, 'state': 'error', 'message': f'ffmpeg: {message[0]}'}
        os.replace(tmp, self.output)
        return {**result, 'state': 'done', 'frames': frames, 'seconds': frames / self.fps}


class Handler(SimpleHTTPRequestHandler):
    """Static page, timelapse endpoints and Worker relay."""

    def __init__(self, *args, store: FrameStore, encoder: VideoEncoder, worker: str, port: int,
                 **kwargs):
        self.store = store
        self.encoder = encoder
        self.worker = worker.rstrip('/')
        self.allowed_hosts = {f'localhost:{port}', f'127.0.0.1:{port}'}
        super().__init__(*args, directory=str(REPO), **kwargs)

    # A web page elsewhere could point a hostname of its own at 127.0.0.1 (DNS
    # rebinding) and then post frames or read files as same-origin: requests must
    # name this server.
    def host_allowed(self) -> bool:
        if self.headers.get('Host') in self.allowed_hosts:
            return True
        self.send_json({'error': 'Host not allowed'}, HTTPStatus.FORBIDDEN)
        return False

    def path_only(self) -> str:
        """Request path, decoded and normalised (``/js/%2e%2e/x`` gives ``/x``)."""
        path = urllib.parse.unquote(self.path.split('?', 1)[0].split('#', 1)[0])
        normalised = posixpath.normpath(path)
        return normalised + '/' if path.endswith('/') and normalised != '/' else normalised

    def do_GET(self):
        if not self.host_allowed():
            return
        path = self.path_only()
        if path == '/version.json':
            self.send_json({'commit': git_commit()})
        elif path == '/api/timelapse/status':
            self.send_json({'next': self.store.peek(), 'folder': str(self.store.folder),
                            'video': self.encoder.snapshot()})
        elif path.startswith('/api/'):
            self.relay()
        # Only the page's own files: the repository root also holds secrets/ and .git/.
        elif path in ('/', '/index.html') or path.startswith(STATIC_PREFIXES):
            super().do_GET()
        else:
            self.send_json({'error': 'Not found'}, HTTPStatus.NOT_FOUND)

    def do_POST(self):
        if not self.host_allowed():
            return
        path = self.path_only()
        if path == '/api/timelapse/frame':
            self.receive_frame()
        elif path == '/api/timelapse/stop':
            self.read_body(1024)  # no body expected; drain any
            self.send_json({'video': self.encoder.request()}, HTTPStatus.ACCEPTED)
        elif path.startswith('/api/'):
            self.relay()
        else:
            self.send_json({'error': 'Not found'}, HTTPStatus.NOT_FOUND)

    def read_body(self, limit: int) -> bytes:
        length = int(self.headers.get('Content-Length', 0))
        if length > limit:
            raise ValueError(f'body larger than {limit} bytes')
        return self.rfile.read(length)

    def receive_frame(self):
        try:
            name = self.store.save(self.read_body(MAX_FRAME_BYTES))
        except ValueError as error:
            self.send_json({'error': str(error)}, HTTPStatus.BAD_REQUEST)
            return
        except OSError as error:  # disk full, permissions
            self.send_json({'error': f'cannot write frame: {error.strerror}'},
                           HTTPStatus.INTERNAL_SERVER_ERROR)
            return
        self.log_message('saved %s', name)
        self.send_json({'name': name, 'folder': str(self.store.folder)})

    def relay(self):
        """Forward the request to the Worker and its answer to the page.

        The Worker only accepts browser requests whose Origin is GitHub Pages; this
        server-to-server request carries no Origin, as a command-line client would,
        so the page served here can still synchronise.
        """
        body = self.read_body(MAX_FRAME_BYTES) if self.command == 'POST' else None
        headers = {key: self.headers[key] for key in RELAYED_HEADERS if self.headers.get(key)}
        headers.setdefault('User-Agent', FALLBACK_USER_AGENT)
        request = urllib.request.Request(self.worker + self.path, data=body, headers=headers,
                                         method=self.command)
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                status, content_type, payload = response.status, response.headers.get('Content-Type'), response.read()
        except urllib.error.HTTPError as error:
            status, content_type, payload = error.code, error.headers.get('Content-Type'), error.read()
        except (urllib.error.URLError, TimeoutError) as error:
            self.send_json({'error': f'Worker unreachable: {error}'}, HTTPStatus.BAD_GATEWAY)
            return
        self.send_response(status)
        self.send_header('Content-Type', content_type or 'application/octet-stream')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def send_json(self, data: dict, status: HTTPStatus = HTTPStatus.OK):
        payload = json.dumps(data).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def end_headers(self):
        # Always the current working tree and state, so the page matches git_commit().
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()

    def log_request(self, code='-', size='-'):
        # One line per saved frame is enough: only failed requests are logged.
        if str(code)[:1] in '45':
            super().log_request(code, size)


class LocalServer(ThreadingHTTPServer):
    """HTTP server that skips the reverse DNS lookup of HTTPServer.server_bind().

    getfqdn('127.0.0.1') can block for about 30 s on macOS before timing out.
    """

    def server_bind(self):
        socketserver.TCPServer.server_bind(self)
        self.server_name, self.server_port = 'localhost', self.server_address[1]


def make_server(port: int, out: Path, worker: str = WORKER, fps: float = 30) -> LocalServer:
    """Build (without starting) the server on 127.0.0.1.

    Args:
        port: TCP port; 0 picks a free one.
        out: Timelapse folder.
        worker: Worker base URL that ``/api/*`` is relayed to.
        fps: Frame rate of the video made when the timelapse stops (frames/s).
    """
    server = LocalServer(('127.0.0.1', port), None)
    server.encoder = VideoEncoder(out, fps)
    server.RequestHandlerClass = partial(Handler, store=FrameStore(out), encoder=server.encoder,
                                         worker=worker, port=server.server_address[1])
    return server


def main():
    parser = argparse.ArgumentParser(description=__doc__.split('\n\n')[0])
    parser.add_argument('--port', type=int, default=8765, help='TCP port (default 8765)')
    parser.add_argument('--out', type=Path, default=REPO / 'timelapse',
                        help='frame folder (default: timelapse/ in the repository)')
    parser.add_argument('--worker', default=WORKER, help='collaboration Worker URL')
    parser.add_argument('--fps', type=float, default=30,
                        help='frame rate of the video made on stop (default 30 frames/s)')
    args = parser.parse_args()
    if args.fps <= 0:
        parser.error('--fps must be positive')
    out = args.out.expanduser().resolve()
    server = make_server(args.port, out, args.worker, args.fps)
    port = server.server_address[1]
    print(f'Timelapse frames: {out} (next {frame_name(next_index(out))})')
    print(f'Video on stop:    {server.encoder.output} ({args.fps:g} frames/s, '
          f'ffmpeg {"found" if shutil.which("ffmpeg") else "NOT FOUND: brew install ffmpeg"})')
    print(f'Commit: {git_commit()}')
    print(f'Open in Safari:   http://localhost:{port}/?admin   (Ctrl-C to stop)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
