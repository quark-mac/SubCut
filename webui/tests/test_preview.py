"""Preview-copy acceptance at public HTTP boundaries, real FFmpeg and real files."""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import shutil

import httpx

from webui.tests.fixtures import create_preview_fixture


class PreviewHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix='webui-preview-')
        cls.root = Path(cls.temp.name)
        cls.video, cls.subtitle = create_preview_fixture(cls.root / 'inputs', offset=5)
        cls.workspace = cls.root / 'workspace'
        cls.start_server()

    @classmethod
    def start_server(cls, launcher=False, **environment):
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        cls.log = (cls.root / 'server.log').open('a', encoding='utf-8')
        command = ([sys.executable, '-m', 'webui', '--no-browser', '--port', str(port)] if launcher else
                   [sys.executable, '-m', 'uvicorn', 'webui.backend.app:app', '--host', '127.0.0.1', '--port', str(port)])
        cls.server = subprocess.Popen(command,
                                      cwd=Path(__file__).resolve().parents[2],
                                      env=dict(os.environ, WEBUI_WORKSPACE=str(cls.workspace), **environment),
                                      stdout=cls.log, stderr=subprocess.STDOUT)
        cls.client = httpx.Client(base_url=f'http://127.0.0.1:{port}', timeout=15)
        for _ in range(100):
            try:
                if cls.client.get('/api/health').is_success:
                    return
            except httpx.TransportError:
                pass
            time.sleep(.1)
        cls.stop_server()
        raise AssertionError('Server failed to start')

    @classmethod
    def stop_server(cls):
        cls.client.close()
        cls.server.terminate()
        cls.server.wait(timeout=10)
        cls.log.close()

    @classmethod
    def tearDownClass(cls):
        cls.stop_server()
        cls.temp.cleanup()

    def create(self, video=None, subtitle=None):
        response = self.client.post('/api/projects', json={'name': '真实预览', 'media_path': str(video or self.video),
                                                           'subtitle_path': str(subtitle or self.subtitle)})
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_actual_probe_ignores_extension_and_uses_playback_origin(self):
        disguised = self.root / 'actually-ffv1.mp4'
        disguised.write_bytes(self.video.read_bytes())
        project = self.create(disguised)
        self.assertEqual(project['media']['duration_ms'], 9000)
        response = self.client.get(f'/api/projects/{project["id"]}/playback')
        self.assertEqual(response.status_code, 200, response.text)
        playback = response.json()
        self.assertIn('matroska', playback['source']['format_name'])
        self.assertEqual(playback['source']['video_codec'], 'ffv1')
        self.assertEqual(playback['source']['audio_codec'], 'pcm_s16le')
        self.assertEqual(playback['source']['start_time_ms'], 5000)
        self.assertTrue(playback['source']['suggest_preview'])
        self.assertIsNone(playback['preview'])

    def finish(self, url, task):
        states = [task['state']]
        for _ in range(600):
            task = self.client.get(url + '/tasks/' + task['id']).json()
            states.append(task['state'])
            self.assertGreaterEqual(task['progress'], 0)
            self.assertLessEqual(task['progress'], 1)
            if task['state'] in ('succeeded', 'failed'):
                return task, states
            time.sleep(.02)
        self.fail('Preview task did not finish')

    def test_real_conversion_registers_complete_cache_and_keeps_edits_and_original_time(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        response = self.client.post(url + '/preview', json={'quality': 'standard'})
        self.assertEqual(response.status_code, 202, response.text)
        task = response.json()
        self.assertEqual(task['state'], 'queued')
        self.assertEqual(self.client.get(url).json()['media_artifacts'], [])
        project['entries'][0]['text'] = '转换期间保存的新文字'
        save = {k: project[k] for k in ('revision', 'name', 'entries', 'speakers', 'subtitle_sources')}
        self.assertEqual(self.client.put(url, json=save).status_code, 200)
        done, states = self.finish(url, task)
        self.assertEqual(done['state'], 'succeeded', done)
        self.assertIn('running', states)
        self.assertEqual(done['progress'], 1)
        saved = self.client.get(url).json()
        self.assertEqual(saved['entries'], project['entries'])
        self.assertEqual(saved['media'], project['media'])
        self.assertEqual(saved['revision'], 2)  # Cache registration has a separate lifecycle.
        self.assertEqual(len(saved['media_artifacts']), 1)
        artifact = saved['media_artifacts'][0]
        self.assertEqual(artifact['media_identity'], project['media']['identity'])
        output = Path(artifact['path'])
        probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(output)]))
        self.assertEqual([s['codec_name'] for s in probe['streams']], ['h264', 'aac'])
        self.assertAlmostEqual(float(probe['format']['duration']), 9, delta=.06)
        self.assertAlmostEqual(float(probe['format']['start_time']), 0, delta=.025)
        playback = self.client.get(url + '/playback').json()
        self.assertEqual(playback['preview']['id'], artifact['id'])
        ranged = self.client.get(playback['url'], headers={'Range': 'bytes=100-299'})
        self.assertEqual(ranged.status_code, 206)
        self.assertEqual(ranged.content, output.read_bytes()[100:300])
        self.assertEqual(self.client.get(playback['url'], headers={'Range': 'bytes=999999999-'}).status_code, 416)
        reused = self.client.post(url + '/preview', json={'quality': 'standard'}).json()
        self.assertTrue(reused['cached'])
        self.assertEqual(reused['artifact_id'], artifact['id'])
        self.assertEqual(self.client.get(url + '/tasks/' + reused['id']).json(), reused)
        # Independent physical references: colored frames and tones at original-time positions.
        import array
        import math
        for seconds, rgb, hz in [(1, (255, 0, 0), 440), (3, (0, 0, 0), 0), (5, (0, 255, 0), 880), (7, (0, 0, 0), 0), (8.5, (0, 0, 255), 1320)]:
            pixel = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', str(seconds), '-i', str(output), '-frames:v', '1', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'])
            for actual, expected in zip(pixel, rgb):
                self.assertAlmostEqual(actual, expected, delta=8)
            pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', str(seconds), '-i', str(output), '-t', '0.1', '-vn', '-ac', '1', '-ar', '48000', '-f', 'f32le', '-'])
            values = array.array('f', pcm)
            rms = math.sqrt(sum(v*v for v in values) / len(values))
            if hz:
                crossings = sum(a <= 0 < b for a, b in zip(values, values[1:]))
                self.assertAlmostEqual(crossings / .1, hz, delta=20)
                self.assertGreater(rms, .2)
            else:
                self.assertLess(rms, .001)
        exported = self.client.post(url + '/exports', json={'revision': saved['revision'], 'format': 'normalized-jsonl'})
        self.assertEqual(exported.status_code, 201, exported.text)
        lines = [json.loads(line) for line in self.client.get(exported.json()['url']).text.splitlines()]
        self.assertEqual([(e['start'], e['end']) for e in lines], [(0.2, 1.8), (4.2, 5.8), (8.1, 8.9)])

    def test_missing_tools_real_generation_failure_retry_and_restart_cache(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        cls = type(self)
        for tool, expected in [(str(self.root / 'missing-ffmpeg.exe'), 'media_tool_missing'), (shutil.which('ffprobe'), 'preview_failed')]:
            cls.stop_server()
            cls.start_server(WEBUI_FFMPEG=tool)
            response = self.client.post(url + '/preview', json={})
            self.assertEqual(response.status_code, 202, response.text)
            failed, _ = self.finish(url, response.json())
            self.assertEqual(failed['state'], 'failed', failed)
            self.assertEqual(failed['error']['code'], expected)
            self.assertEqual(self.client.get(url).json(), project)
            self.assertIsNone(self.client.get(url + '/playback').json()['preview'])
            self.assertEqual(list((self.workspace / project['id'] / 'previews').glob('*.mp4')), [])
        cls.stop_server()
        cls.start_server()
        done, _ = self.finish(url, self.client.post(url + '/preview', json={}).json())
        self.assertEqual(done['state'], 'succeeded', done)
        cls.stop_server()
        cls.start_server()
        reused = self.client.post(url + '/preview', json={}).json()
        self.assertTrue(reused['cached'])
        self.assertEqual(reused['artifact_id'], done['artifact_id'])
        cls.stop_server()
        cls.start_server(WEBUI_FFPROBE=str(self.root / 'missing-ffprobe.exe'))
        self.assertEqual(self.client.get(url + '/playback').status_code, 503)
        latest = self.client.get(url).json()
        latest['entries'][0]['text'] = '无工具时仍可保存'
        self.assertEqual(self.client.put(url, json={k: latest[k] for k in ('revision', 'name', 'entries')}).status_code, 200)
        self.assertEqual(self.client.get(url).json()['entries'], latest['entries'])
        cls.stop_server()
        cls.start_server()

    def test_parameters_output_integrity_and_source_changes_invalidate_cache(self):
        source = self.root / 'mutable.mkv'
        source.write_bytes(self.video.read_bytes())
        project = self.create(source)
        url = f'/api/projects/{project["id"]}'
        done, _ = self.finish(url, self.client.post(url + '/preview', json={}).json())
        self.assertEqual(done['state'], 'succeeded', done)
        self.assertIsNone(self.client.get(url + '/playback?quality=small').json()['preview'])
        small, _ = self.finish(url, self.client.post(url + '/preview', json={'quality': 'small'}).json())
        self.assertEqual(small['state'], 'succeeded', small)
        self.assertNotEqual(small['artifact_id'], done['artifact_id'])
        saved = self.client.get(url).json()
        artifact = next(a for a in saved['media_artifacts'] if a['id'] == done['artifact_id'])
        Path(artifact['path']).write_bytes(b'broken but still exists')
        self.assertIsNone(self.client.get(url + '/playback').json()['preview'])
        self.assertEqual(self.client.get(url + '/previews/' + artifact['id']).status_code, 409)
        self.assertTrue(self.client.post(url + '/preview', json={'quality': 'small'}).json()['cached'])
        Path(next(a for a in saved['media_artifacts'] if a['id'] == small['artifact_id'])['path']).unlink()
        self.assertIsNone(self.client.get(url + '/playback?quality=small').json()['preview'])
        with source.open('ab') as output:
            output.write(b'changed source identity')
        for endpoint in ['/media', '/playback', '/previews/' + artifact['id']]:
            self.assertEqual(self.client.get(url + endpoint).status_code, 409)
        self.assertEqual(self.client.post(url + '/preview', json={}).status_code, 409)
        self.assertTrue(all(a['status'] == 'stale' for a in self.client.get(url + '/resources').json()['media_artifacts']))
        source.unlink()
        self.assertEqual(self.client.post(url + '/preview', json={}).status_code, 404)
        self.assertEqual(self.client.get(url).json()['entries'], project['entries'])

    def test_silent_video_is_valid_without_inventing_an_audio_track(self):
        video, subtitle = create_preview_fixture(self.root / 'silent', silent=True)
        project = self.create(video, subtitle)
        url = f'/api/projects/{project["id"]}'
        done, _ = self.finish(url, self.client.post(url + '/preview', json={}).json())
        self.assertEqual(done['state'], 'succeeded', done)
        self.assertIsNone(self.client.get(url + '/playback').json()['source']['audio_codec'])
        artifact = self.client.get(url).json()['media_artifacts'][0]
        info = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-of', 'json', artifact['path']]))
        self.assertEqual([s['codec_name'] for s in info['streams']], ['h264'])

    def test_delayed_audio_keeps_its_offset_relative_to_video(self):
        source = self.root / 'delayed-audio.mkv'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(self.video), '-itsoffset', '0.5', '-i', str(self.video),
                        '-map', '0:v', '-map', '1:a', '-c', 'copy', '-output_ts_offset', '5', str(source)], check=True)
        project = self.create(source)
        self.assertAlmostEqual(project['media']['duration_ms'], 9500, delta=1)
        url = f'/api/projects/{project["id"]}'
        done, _ = self.finish(url, self.client.post(url + '/preview', json={}).json())
        self.assertEqual(done['state'], 'succeeded', done)
        output = self.client.get(url).json()['media_artifacts'][0]['path']
        import array
        for seconds, audible in [('0.2', False), ('0.7', True), ('2.3', True), ('2.7', False)]:
            pcm = subprocess.check_output(['ffmpeg', '-v', 'error', '-ss', seconds, '-i', output, '-t', '0.1', '-vn', '-f', 'f32le', '-'])
            samples = array.array('f', pcm)
            power = sum(v*v for v in samples) / len(samples)
            self.assertEqual(power > .01, audible, (seconds, power))

    def test_launcher_uses_configured_tools_without_path_and_opens_saved_work_without_tools(self):
        cls = type(self)
        cls.stop_server()
        cls.start_server(launcher=True, PATH='', WEBUI_FFPROBE=shutil.which('ffprobe'), WEBUI_FFMPEG=shutil.which('ffmpeg'))
        try:
            project = self.create()
            url = f'/api/projects/{project["id"]}'
            done, _ = self.finish(url, self.client.post(url + '/preview', json={}).json())
            self.assertEqual(done['state'], 'succeeded', done)
            cls.stop_server()
            cls.start_server(launcher=True, PATH='')
            self.assertEqual(self.client.get('/').status_code, 200)
            project = self.client.get(url).json()
            self.assertEqual(self.client.get(url + '/playback').status_code, 503)
            project['entries'][0]['text'] = '启动时没有媒体工具也能编辑'
            saved = self.client.put(url, json={k: project[k] for k in ('revision', 'name', 'entries')})
            self.assertEqual(saved.status_code, 200)
            self.assertEqual(saved.json()['entries'], project['entries'])
        finally:
            cls.stop_server()
            cls.start_server()


if __name__ == '__main__':
    unittest.main()
