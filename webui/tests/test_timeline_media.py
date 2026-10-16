"""Actual source-time waveform/thumbnail jobs through HTTP, not mocked media."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
import subprocess
from threading import Barrier
import time
import unittest
import shutil

from webui.tests import test_preview
from webui.tests.fixtures import create_preview_fixture


class TimelineMediaHTTPTests(unittest.TestCase):
    # Same real server lifecycle; preview regressions still run once in their own suite.
    setUpClass = classmethod(test_preview.PreviewHTTPTests.setUpClass.__func__)
    tearDownClass = classmethod(test_preview.PreviewHTTPTests.tearDownClass.__func__)
    start_server = classmethod(test_preview.PreviewHTTPTests.start_server.__func__)
    stop_server = classmethod(test_preview.PreviewHTTPTests.stop_server.__func__)
    create = test_preview.PreviewHTTPTests.create
    finish = test_preview.PreviewHTTPTests.finish

    def test_waveform_is_real_and_carries_source_time(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        response = self.client.post(url + '/timeline-media/waveform', json={})
        self.assertEqual(response.status_code, 202, response.text)
        done, states = self.finish(url, response.json())
        self.assertEqual(done['state'], 'succeeded', done)
        self.assertIn('running', states)
        result = self.client.get(url + '/timeline-media/waveform').json()
        self.assertEqual(result['artifact']['id'], done['artifact_id'])
        wave = self.client.get(result['url'], params={'start_ms': 0, 'end_ms': 9000, 'bins': 900}).json()
        self.assertEqual(wave['duration_ms'], 9000)
        self.assertTrue(wave['has_audio'])
        for ms, audible in [(1000, True), (3000, False), (5000, True), (7000, False), (8500, True)]:
            peak = next(p['peak'] for p in wave['peaks'] if p['start_ms'] <= ms < p['end_ms'])
            self.assertEqual(peak > .3, audible, (ms, peak))
        saved = self.client.get(url).json()
        self.assertEqual(saved['entries'], project['entries'])
        self.assertEqual(saved['revision'], 1)
        self.assertTrue(self.client.post(url + '/timeline-media/waveform', json={}).json()['cached'])

    def test_thumbnails_are_actual_frames_at_explicit_source_times(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        response = self.client.post(url + '/timeline-media/thumbnails', json={})
        self.assertEqual(response.status_code, 202, response.text)
        done, _ = self.finish(url, response.json())
        self.assertEqual(done['state'], 'succeeded', done)
        self.assertEqual(done.get('progress_source'), 'sampled_frames')
        self.assertEqual(done.get('processed_frames'), 9)
        result = self.client.get(url + '/timeline-media/thumbnails').json()
        manifest = self.client.get(result['url']).json()
        self.assertEqual(manifest['duration_ms'], 9000)
        self.assertEqual([f['time_ms'] for f in manifest['frames']], list(range(0, 9000, 1000)))
        for ms, rgb in [(1000, (255, 0, 0)), (3000, (0, 0, 0)), (5000, (0, 255, 0)), (7000, (0, 0, 0)), (8000, (0, 0, 255))]:
            frame = next(f for f in manifest['frames'] if f['time_ms'] == ms)
            response = self.client.get(frame['url'])
            self.assertEqual(response.status_code, 200, response.text[:100])
            pixel = subprocess.check_output(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], input=response.content)
            for actual, expected in zip(pixel, rgb):
                self.assertAlmostEqual(actual, expected, delta=10)
        self.assertEqual(self.client.get(url).json()['revision'], 1)
        self.assertTrue(self.client.post(url + '/timeline-media/thumbnails', json={}).json()['cached'])

    def test_delayed_audio_silence_and_preview_use_one_common_origin(self):
        delayed = self.root / 'timeline-delayed.mkv'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(self.video), '-itsoffset', '0.5', '-i', str(self.video),
                        '-map', '0:v', '-map', '1:a', '-c', 'copy', '-output_ts_offset', '5', str(delayed)], check=True)
        project = self.create(delayed)
        url = f'/api/projects/{project["id"]}'
        for kind in ('waveform', 'thumbnails'):
            done, _ = self.finish(url, self.client.post(url + '/timeline-media/' + kind, json={}).json())
            self.assertEqual(done['state'], 'succeeded', done)
        wave_url = self.client.get(url + '/timeline-media/waveform').json()['url']
        wave = self.client.get(wave_url, params={'end_ms': 9500, 'bins': 950}).json()
        self.assertEqual(wave['duration_ms'], project['media']['duration_ms'])
        self.assertAlmostEqual(wave['duration_ms'], 9500, delta=1)
        for ms, audible in [(200, False), (700, True), (2300, True), (2700, False), (4700, True), (6700, False), (8700, True)]:
            peak = next(p['peak'] for p in wave['peaks'] if p['start_ms'] <= ms < p['end_ms'])
            self.assertEqual(peak > .3, audible, (ms, peak))
        preview, _ = self.finish(url, self.client.post(url + '/preview', json={}).json())
        self.assertEqual(preview['state'], 'succeeded', preview)
        original_manifest = self.client.get(self.client.get(url + '/timeline-media/thumbnails').json()['url']).json()
        saved = self.client.get(url).json()
        preview_path = next(a['path'] for a in saved['media_artifacts'] if a['id'] == preview['artifact_id'])
        other = self.create(Path(preview_path))
        other_url = f'/api/projects/{other["id"]}'
        for kind in ('waveform', 'thumbnails'):
            done, _ = self.finish(other_url, self.client.post(other_url + '/timeline-media/' + kind, json={}).json())
            self.assertEqual(done['state'], 'succeeded', done)
        preview_wave = self.client.get(self.client.get(other_url + '/timeline-media/waveform').json()['url'], params={'end_ms': 9500, 'bins': 950}).json()
        for ms in [200, 700, 2300, 2700, 4700, 6700, 8700]:
            peak = next(p['peak'] for p in preview_wave['peaks'] if p['start_ms'] <= ms < p['end_ms'])
            source_peak = next(p['peak'] for p in wave['peaks'] if p['start_ms'] <= ms < p['end_ms'])
            self.assertAlmostEqual(peak, source_peak, delta=.03)
        preview_manifest = self.client.get(self.client.get(other_url + '/timeline-media/thumbnails').json()['url']).json()
        self.assertEqual([f['time_ms'] for f in preview_manifest['frames']], [f['time_ms'] for f in original_manifest['frames']])
        for index in [1, 3, 5, 7, 8]:
            pixels = []
            for manifest in [original_manifest, preview_manifest]:
                pixels.append(subprocess.check_output(['ffmpeg', '-v', 'error', '-i', 'pipe:0', '-vf', 'scale=1:1', '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'],
                                                     input=self.client.get(manifest['frames'][index]['url']).content))
            for a, b in zip(*pixels):
                self.assertAlmostEqual(a, b, delta=10)
        silent, subtitle = create_preview_fixture(self.root / 'timeline-silent', offset=5, silent=True)
        silent_project = self.create(silent, subtitle)
        silent_url = f'/api/projects/{silent_project["id"]}'
        done, _ = self.finish(silent_url, self.client.post(silent_url + '/timeline-media/waveform', json={}).json())
        self.assertEqual(done['state'], 'succeeded', done)
        wave = self.client.get(self.client.get(silent_url + '/timeline-media/waveform').json()['url']).json()
        self.assertEqual(wave, {'duration_ms': 9000, 'has_audio': False, 'peaks': []})

    def test_cache_parameters_integrity_restart_and_changed_source(self):
        source = self.root / 'mutable-timeline.mkv'
        shutil.copyfile(self.video, source)
        project = self.create(source)
        url = f'/api/projects/{project["id"]}'
        for kind in ('waveform', 'thumbnails'):
            endpoint = url + '/timeline-media/' + kind
            done, _ = self.finish(url, self.client.post(endpoint, json={}).json())
            self.assertEqual(done['state'], 'succeeded', done)
            standard_url = self.client.get(endpoint).json()['url']
            self.assertIsNone(self.client.get(endpoint + '?density=detailed').json()['artifact'])
            detailed, _ = self.finish(url, self.client.post(endpoint, json={'density': 'detailed'}).json())
            self.assertEqual(detailed['state'], 'succeeded', detailed)
            self.assertNotEqual(detailed['artifact_id'], done['artifact_id'])
            if kind == 'thumbnails':
                manifest = self.client.get(self.client.get(endpoint + '?density=detailed').json()['url']).json()
                self.assertEqual(manifest['frames'][1]['time_ms'], 500)
            cls = type(self)
            cls.stop_server(); cls.start_server()
            self.assertEqual(self.client.post(endpoint, json={}).json()['artifact_id'], done['artifact_id'])
            saved = self.client.get(url).json()
            artifact = next(a for a in saved['media_artifacts'] if a['id'] == done['artifact_id'])
            Path(artifact['path']).write_bytes(b'corrupt actual output')
            self.assertIsNone(self.client.get(endpoint).json()['artifact'])
            self.assertEqual(self.client.get(standard_url).status_code, 409)
            self.assertTrue(self.client.post(endpoint, json={'density': 'detailed'}).json()['cached'])
        with source.open('ab') as output:
            output.write(b'new source identity')
        for kind in ('waveform', 'thumbnails'):
            self.assertEqual(self.client.get(url + '/timeline-media/' + kind).status_code, 409)
            self.assertEqual(self.client.post(url + '/timeline-media/' + kind, json={}).status_code, 409)
        self.assertTrue(all(a['status'] == 'stale' for a in self.client.get(url + '/resources').json()['media_artifacts']))
        self.assertEqual(self.client.get(url).json()['entries'], project['entries'])

    def test_concurrent_pollers_never_interrupt_real_media_jobs(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        for kind in ('waveform', 'thumbnails'):
            ready = Barrier(7)
            task = {}

            def observe():
                ready.wait(timeout=10)
                states = []
                deadline = time.monotonic() + 15
                while time.monotonic() < deadline:
                    response = self.client.get(url + '/tasks/' + task['id'])
                    self.assertEqual(response.status_code, 200, response.text)
                    value = response.json()
                    states.append(value['state'])
                    if value['state'] in ('succeeded', 'failed'):
                        self.assertEqual(value['state'], 'succeeded', value)
                        return states
                self.fail('Concurrent polling never observed a completed real media job')

            with ThreadPoolExecutor(max_workers=6) as readers:
                observations = [readers.submit(observe) for _ in range(6)]
                response = self.client.post(url + '/timeline-media/' + kind, json={})
                try:
                    self.assertEqual(response.status_code, 202, response.text)
                    task.update(response.json())
                finally:
                    ready.wait(timeout=10)
                for observation in observations:
                    self.assertTrue(observation.result())
        saved = self.client.get(url).json()
        self.assertEqual(saved['entries'], project['entries'])
        self.assertEqual(saved['revision'], 1)
        self.assertEqual(len(saved['media_artifacts']), 2)

    def test_failures_do_not_publish_and_retry_keeps_concurrent_save(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        cls = type(self)
        for tool in [str(self.root / 'missing-ffmpeg.exe'), shutil.which('ffprobe')]:
            cls.stop_server(); cls.start_server(WEBUI_FFMPEG=tool)
            for kind in ('waveform', 'thumbnails'):
                response = self.client.post(url + '/timeline-media/' + kind, json={})
                self.assertEqual(response.status_code, 202, response.text)
                done, _ = self.finish(url, response.json())
                self.assertEqual(done['state'], 'failed', done)
                self.assertIn(done['error']['code'], ('media_tool_missing', kind + '_failed'))
                self.assertIsNone(self.client.get(url + '/timeline-media/' + kind).json()['artifact'])
                self.assertEqual(self.client.get(url).json()['media_artifacts'], [])
        cls.stop_server(); cls.start_server()
        for kind in ('waveform', 'thumbnails'):
            response = self.client.post(url + '/timeline-media/' + kind, json={})
            latest = self.client.get(url).json()
            latest['entries'][0]['text'] = '后台生成期间保存 ' + kind
            saved = self.client.put(url, json={k: latest[k] for k in ('revision', 'name', 'entries', 'speakers', 'subtitle_sources')})
            self.assertEqual(saved.status_code, 200, saved.text)
            done, _ = self.finish(url, response.json())
            self.assertEqual(done['state'], 'succeeded', done)
            actual = self.client.get(url).json()
            self.assertEqual(actual['entries'], latest['entries'])
            self.assertEqual(actual['revision'], saved.json()['revision'])
        self.assertEqual(list((self.workspace / project['id'] / 'timeline-media').glob('*.partial*')), [])
