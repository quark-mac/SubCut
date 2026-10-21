"""Lifecycle through HTTP, including expiry and real media-job exclusion."""
import json
import time
import unittest
from unittest.mock import patch

from webui.backend.recycle import RecycleBin, RETENTION_SECONDS
from webui.backend.storage import Store
from webui.backend.errors import Problem

from webui.tests import test_http


class RecycleHTTPTests(unittest.TestCase):
    setUpClass = classmethod(test_http.ProjectHTTPTests.setUpClass.__func__)
    tearDownClass = classmethod(test_http.ProjectHTTPTests.tearDownClass.__func__)
    create = test_http.ProjectHTTPTests.create

    def test_recycle_restore_expire_preserves_sources_and_prevents_stale_save(self):
        project = self.create()
        url = f"/api/projects/{project['id']}"
        source = self.video.read_bytes()
        exported = self.client.post(url + '/exports', json={'revision': project['revision']}).json()
        project = exported['project']
        output = self.client.get(exported['url']).content
        self.assertEqual(self.client.request('DELETE', url, json={'revision': 0}).status_code, 409)
        deleted = self.client.request('DELETE', url, json={'revision': project['revision']})
        self.assertEqual(deleted.status_code, 200, deleted.text)
        self.assertEqual(self.client.get(url).status_code, 404)
        self.assertNotIn(project['id'], [p['id'] for p in self.client.get('/api/projects').json()])
        self.assertIn(project['id'], [p['id'] for p in self.client.get('/api/recycle-bin').json()])
        self.assertEqual(self.client.post(f"/api/recycle-bin/{project['id']}/restore").status_code, 200)
        restored = self.client.get(url).json()
        self.assertEqual(restored['entries'], project['entries'])
        self.assertEqual(restored['revision'], project['revision'] + 1)
        self.assertEqual(self.client.get(exported['url']).content, output)
        stale = self.client.put(url, json={k: project[k] for k in ('revision', 'name', 'entries', 'speakers')})
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(self.client.request('DELETE', url, json={'revision': restored['revision']}).status_code, 200)
        receipt = self.workspace / '.trash' / project['id'] / 'receipt.json'
        data = json.loads(receipt.read_text(encoding='utf-8'))
        data['deleted_at'] = time.time() - 8 * 86400
        receipt.write_text(json.dumps(data), encoding='utf-8')
        self.assertNotIn(project['id'], [p['id'] for p in self.client.get('/api/recycle-bin').json()])
        self.assertFalse(receipt.parent.exists())
        self.assertEqual(self.client.post(f"/api/recycle-bin/{project['id']}/restore").status_code, 404)
        self.assertEqual(self.video.read_bytes(), source)
        self.assertTrue(self.subtitle.is_file())

    def test_lock_legacy_default_persists_copies_and_does_not_filter_exports(self):
        project = self.create()
        self.assertTrue(all(s['locked'] is False for s in project['speakers']))
        url = f"/api/projects/{project['id']}"
        body = {k: project[k] for k in ('revision', 'name', 'entries', 'speakers')}
        body['speakers'][0]['locked'] = True
        saved = self.client.put(url, json=body)
        self.assertEqual(saved.status_code, 200)
        saved = saved.json()
        copied = self.client.post(url + '/save-as', json={'revision': saved['revision'], 'name': 'locked copy'}).json()
        self.assertTrue(copied['speakers'][0]['locked'])
        exported = self.client.post(url + '/exports', json={'revision': saved['revision'], 'format': 'moss-json'}).json()
        self.assertEqual(len(self.client.get(exported['url']).json()), len(project['entries']))
        legacy = exported['project']
        for speaker in legacy['speakers']:
            speaker.pop('locked')
        (self.workspace / project['id'] / 'project.json').write_text(json.dumps(legacy), encoding='utf-8')
        self.assertTrue(all(not s['locked'] for s in self.client.get(url).json()['speakers']))

    def test_running_job_blocks_delete_until_completion(self):
        project = self.create()
        url = f"/api/projects/{project['id']}"
        job = self.client.post(url + '/preview', json={'quality': 'standard'})
        self.assertEqual(job.status_code, 202)
        response = self.client.request('DELETE', url, json={'revision': project['revision']})
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()['error']['code'], 'project_busy')
        for _ in range(200):
            state = self.client.get(url + '/tasks/' + job.json()['id']).json()['state']
            if state not in ('queued', 'running'):
                break
            time.sleep(.05)
        self.assertEqual(state, 'succeeded')
        self.assertEqual(self.client.request('DELETE', url, json={'revision': project['revision']}).status_code, 200)

    def test_snapshot_save_preserves_lock_and_accepts_coalesced_history(self):
        project = self.create()
        url = f"/api/projects/{project['id']}"

        def save(snapshot):
            return self.client.put(url, json={k: snapshot[k] for k in ('revision', 'name', 'entries', 'speakers')})

        ordinary = {'id': 'snapshot-lock-speaker', 'label': '甲', 'color': '#71a8cc', 'order': 0,
                    'visible': True, 'locked': False}
        for speaker in project['speakers']:
            speaker['order'] += 1
        project['speakers'].insert(0, ordinary)
        project['entries'][0]['speaker_id'] = ordinary['id']
        created = save(project)
        self.assertEqual(created.status_code, 200, created.text)
        project = created.json()
        project['speakers'][0]['locked'] = True
        locked = save(project)
        self.assertEqual(locked.status_code, 200, locked.text)
        current = locked.json()

        changed = json.loads(json.dumps(current))
        # One autosave can coalesce unlock/edit/relock, or several undo steps.
        changed['entries'][0]['text'] = '解锁编辑后重新锁定的快照'
        response = save(changed)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['speakers'][0]['locked'])
        current['revision'] = response.json()['revision']
        response = save(current)
        self.assertEqual(response.status_code, 200, response.text)
        current = response.json()
        self.assertEqual(current['entries'], project['entries'])
        # An older client omitting the field keeps the persisted lock.
        for speaker in current['speakers']:
            speaker.pop('locked')
        response = save(current)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertTrue(response.json()['speakers'][0]['locked'])

    def test_expired_payload_cleanup_retries_after_sharing_failure_and_cannot_restore(self):
        project = self.create()
        url = f"/api/projects/{project['id']}"
        self.assertEqual(self.client.request('DELETE', url, json={'revision': project['revision']}).status_code, 200)
        folder = self.workspace / '.trash' / project['id']
        receipt = folder / 'receipt.json'
        data = json.loads(receipt.read_text(encoding='utf-8'))
        data['deleted_at'] = time.time() - RETENTION_SECONDS - 1
        receipt.write_text(json.dumps(data), encoding='utf-8')
        recycle = RecycleBin(Store(self.workspace))
        with patch('webui.backend.recycle.shutil.rmtree', side_effect=PermissionError('sharing lock')):
            recycle.cleanup()
            self.assertTrue(receipt.is_file())
            self.assertNotIn(project['id'], [p['id'] for p in recycle.listing()])
            with self.assertRaises(Problem) as caught:
                recycle.restore(project['id'])
            self.assertEqual(caught.exception.status, 404)
        recycle.cleanup()
        self.assertFalse(folder.exists())
        self.assertTrue(self.video.is_file())
        self.assertTrue(self.subtitle.is_file())
