"""Tests of tools/timelapse_server.py, against a real server on a free port.

Run with: python3 -m unittest discover -s tools
"""

import http.client
import json
import shutil
import struct
import tempfile
import time
import threading
import unittest
import zlib
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from unittest import mock

import timelapse_server as ts


def tiny_png() -> bytes:
    """Minimal valid 1 × 1 RGB PNG."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (len(data).to_bytes(4, 'big') + kind + data
                + zlib.crc32(kind + data).to_bytes(4, 'big'))
    return (ts.PNG_SIGNATURE + chunk(b'IHDR', bytes([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]))
            + chunk(b'IDAT', zlib.compress(b'\x00\xff\x00\x00')) + chunk(b'IEND', b''))


def grey_png(level: int, size: int = 16) -> bytes:
    """Valid size × size grey PNG (even size, as yuv420p video requires)."""
    def chunk(kind: bytes, data: bytes) -> bytes:
        return (len(data).to_bytes(4, 'big') + kind + data
                + zlib.crc32(kind + data).to_bytes(4, 'big'))
    rows = b''.join(b'\x00' + bytes([level]) * size for _ in range(size))
    return (ts.PNG_SIGNATURE + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 0, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(rows)) + chunk(b'IEND', b''))


def wait_until_settled(encoder, timeout=60):
    deadline = time.time() + timeout
    while encoder.snapshot()['state'] == 'encoding' and time.time() < deadline:
        time.sleep(0.05)
    return encoder.snapshot()


class FakeWorker(BaseHTTPRequestHandler):
    """Records what the relay sends, and answers like the Worker."""
    seen = []

    def do_POST(self):
        body = self.rfile.read(int(self.headers.get('Content-Length', 0)))
        FakeWorker.seen.append((self.path, dict(self.headers), body))
        status = 403 if self.headers.get('Origin') else 200
        payload = json.dumps({'version': 3, 'echo': len(body)}).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, *args):
        pass


def start(server):
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    return server


class FrameNumbering(unittest.TestCase):
    def test_names_and_resume(self):
        self.assertEqual(ts.frame_name(342), '000342.png')
        self.assertRaises(ValueError, ts.frame_name, 0)
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp)
            self.assertEqual(ts.next_index(folder / 'missing'), 1)
            for name in ('000001.png', '000342.png', '12.png', '.x.png.tmp', 'notes.txt'):
                (folder / name).write_bytes(b'')
            self.assertEqual(ts.next_index(folder), 343)

    def test_store_writes_in_sequence_and_rejects_non_png(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = ts.FrameStore(Path(tmp) / 'timelapse')
            self.assertEqual(store.peek(), '000001.png')
            self.assertEqual(store.save(tiny_png()), '000001.png')
            self.assertEqual(store.save(tiny_png()), '000002.png')
            self.assertRaises(ValueError, store.save, b'GIF89a')
            names = sorted(p.name for p in store.folder.iterdir())
            self.assertEqual(names, ['000001.png', '000002.png'], 'no temporary file left')
            self.assertEqual((store.folder / '000002.png').read_bytes(), tiny_png())

    def test_concurrent_frames_get_distinct_numbers(self):
        with tempfile.TemporaryDirectory() as tmp:
            store = ts.FrameStore(Path(tmp))
            names = []
            threads = [threading.Thread(target=lambda: names.append(store.save(tiny_png())))
                       for _ in range(20)]
            for thread in threads:
                thread.start()
            for thread in threads:
                thread.join()
            self.assertEqual(sorted(names), [ts.frame_name(i) for i in range(1, 21)])


class Video(unittest.TestCase):
    def test_command_is_the_documented_one_made_unattended(self):
        command = ts.ffmpeg_command(Path('/r/timelapse'), Path('/r/.timelapse.mp4.tmp'), 30, 7)
        self.assertEqual(command, [
            'ffmpeg', '-hide_banner', '-loglevel', 'error', '-nostdin', '-y',
            '-framerate', '30', '-start_number', '7', '-i', '/r/timelapse/%06d.png',
            '-pix_fmt', 'yuv420p', '-f', 'mp4', '/r/.timelapse.mp4.tmp'])

    def test_missing_ffmpeg_or_frames_is_an_error(self):
        with tempfile.TemporaryDirectory() as tmp:
            encoder = ts.VideoEncoder(Path(tmp) / 'timelapse')
            self.assertEqual(encoder.output, Path(tmp) / 'timelapse.mp4')
            with mock.patch.object(ts.shutil, 'which', return_value=None):
                encoder.request()
                status = wait_until_settled(encoder)
            self.assertEqual(status['state'], 'error')
            self.assertIn('brew install ffmpeg', status['message'])
            if shutil.which('ffmpeg'):
                encoder.request()
                self.assertIn('no frames', wait_until_settled(encoder)['message'])

    @unittest.skipUnless(shutil.which('ffmpeg'), 'ffmpeg not installed')
    def test_encodes_the_sequence_from_its_first_frame(self):
        with tempfile.TemporaryDirectory() as tmp:
            folder = Path(tmp) / 'timelapse'
            folder.mkdir()
            # Starts above 4 and has a gap: ffmpeg takes 000010–000014 only.
            for n in (10, 11, 12, 13, 14, 20):
                (folder / ts.frame_name(n)).write_bytes(grey_png(10 * n))
            encoder = ts.VideoEncoder(folder, fps=5)
            encoder.request()
            status = wait_until_settled(encoder)
            self.assertEqual(status['state'], 'done', status)
            self.assertEqual((status['frames'], status['seconds']), (5, 1.0))
            self.assertGreater(encoder.output.stat().st_size, 0)
            self.assertEqual(encoder.output.read_bytes()[4:8], b'ftyp', 'an MP4 file')
            self.assertEqual(sorted(p.name for p in Path(tmp).iterdir()), ['timelapse', 'timelapse.mp4'],
                             'no temporary file left')

    def test_request_during_encoding_runs_again(self):
        with tempfile.TemporaryDirectory() as tmp:
            encoder = ts.VideoEncoder(Path(tmp) / 'timelapse')
            started, release, runs = threading.Event(), threading.Event(), []

            def encode():
                runs.append(1)
                started.set()
                release.wait(10)
                return {'state': 'done', 'path': str(encoder.output), 'frames': len(runs)}
            encoder.encode = encode
            encoder.request()
            started.wait(10)
            self.assertEqual(encoder.request()['state'], 'encoding')
            self.assertEqual(encoder.request()['state'], 'encoding', 'requests coalesce')
            release.set()
            self.assertEqual(wait_until_settled(encoder)['frames'], 2)


class Server(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.out = Path(self.tmp.name) / 'timelapse'
        FakeWorker.seen = []
        self.worker = start(ts.LocalServer(('127.0.0.1', 0), FakeWorker))
        worker_url = f'http://127.0.0.1:{self.worker.server_address[1]}'
        self.server = start(ts.make_server(0, self.out, worker_url))
        self.port = self.server.server_address[1]

    def tearDown(self):
        for server in (self.server, self.worker):
            server.shutdown()
            server.server_close()
        self.tmp.cleanup()

    def request(self, method, path, body=None, headers=None, host=None):
        connection = http.client.HTTPConnection('127.0.0.1', self.port, timeout=10)
        connection.putrequest(method, path, skip_host=True)
        connection.putheader('Host', host or f'localhost:{self.port}')
        for key, value in (headers or {}).items():
            connection.putheader(key, value)
        connection.putheader('Content-Length', str(len(body or b'')))
        connection.endheaders(body)
        response = connection.getresponse()
        data = response.read()
        connection.close()
        return response.status, response.getheader('Content-Type'), data

    def test_serves_the_page_only(self):
        status, kind, body = self.request('GET', '/?admin')
        self.assertEqual(status, 200)
        self.assertIn(b'js/timelapse.js', body)
        self.assertEqual(self.request('GET', '/js/timelapse.js')[0], 200)
        for path in ('/secrets', '/.git/config', '/README.md', '/js/../secrets',
                     '/js/%2e%2e/secrets', '/css/%2E%2E/.git/HEAD', '/tools/timelapse_server.py'):
            self.assertEqual(self.request('GET', path)[0], 404, path)

    def test_rejects_other_hosts(self):
        self.assertEqual(self.request('GET', '/', host='evil.example:80')[0], 403)
        status = self.request('POST', '/api/timelapse/frame', tiny_png(), host='evil.example')[0]
        self.assertEqual(status, 403)
        self.assertFalse(self.out.exists())

    def test_frames_status_and_version(self):
        status, _, body = self.request('GET', '/api/timelapse/status')
        self.assertEqual(json.loads(body), {
            'next': '000001.png', 'folder': str(self.out),
            'video': {'state': 'idle', 'path': str(self.out) + '.mp4'}})
        status, _, body = self.request('POST', '/api/timelapse/frame', tiny_png(),
                                       {'Content-Type': 'image/png'})
        self.assertEqual((status, json.loads(body)['name']), (200, '000001.png'))
        self.assertEqual((self.out / '000001.png').read_bytes(), tiny_png())
        self.assertEqual(self.request('POST', '/api/timelapse/frame', b'not a png')[0], 400)
        with mock.patch.object(ts.shutil, 'which', return_value=None):
            status, _, body = self.request('POST', '/api/timelapse/stop')
            self.assertEqual(status, 202)
            self.assertEqual(json.loads(body)['video']['path'], str(self.out) + '.mp4')
            wait_until_settled(self.server.encoder)
        video = json.loads(self.request('GET', '/api/timelapse/status')[2])['video']
        self.assertEqual(video['state'], 'error')
        commit = json.loads(self.request('GET', '/version.json')[2])['commit']
        self.assertRegex(commit, r'^([0-9a-f]{40}(-dirty)?|unknown)$')

    def test_relays_sync_without_origin(self):
        payload = b'\x1f\x8b gzip delta'
        status, kind, body = self.request('POST', '/api/sync?x=1', payload, {
            'Content-Type': 'application/octet-stream', 'X-Payload-Encoding': 'gzip',
            'X-Collaborator-ID': 'a' * 32, 'Origin': f'http://localhost:{self.port}',
            'Cookie': 'private=1'
        })
        self.assertEqual(status, 200)
        self.assertEqual(json.loads(body), {'version': 3, 'echo': len(payload)})
        path, headers, received = FakeWorker.seen[-1]
        self.assertEqual((path, received), ('/api/sync?x=1', payload))
        self.assertEqual(headers['X-Payload-Encoding'], 'gzip')
        self.assertEqual(headers['X-Collaborator-Id'], 'a' * 32)
        self.assertNotIn('Origin', headers)
        self.assertNotIn('Cookie', headers)
        # Cloudflare rejects urllib's default User-Agent (error 1010).
        self.assertEqual(headers['User-Agent'], ts.FALLBACK_USER_AGENT)


if __name__ == '__main__':
    unittest.main()
