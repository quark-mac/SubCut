"""Black-box HTTP tests: a real local server and generated media, no mocks."""
import json
import copy
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import unittest
from concurrent.futures import ThreadPoolExecutor

import httpx

from webui.tests.fixtures import SRT, create_fixtures


class ProjectHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory(prefix="webui-http-")
        cls.root = Path(cls.temp.name)
        cls.video, cls.subtitle = create_fixtures(cls.root / "inputs")
        cls.workspace = cls.root / "workspace"
        with socket.socket() as sock:
            sock.bind(("127.0.0.1", 0))
            port = sock.getsockname()[1]
        env = dict(os.environ, WEBUI_WORKSPACE=str(cls.workspace))
        cls.log = (cls.root / "server.log").open("w+", encoding="utf-8")
        cls.server = subprocess.Popen([
            sys.executable, "-m", "uvicorn", "webui.backend.app:app",
            "--host", "127.0.0.1", "--port", str(port),
        ], cwd=Path(__file__).resolve().parents[2], env=env,
            stdout=cls.log, stderr=subprocess.STDOUT)
        cls.client = httpx.Client(base_url=f"http://127.0.0.1:{port}", timeout=10)
        for _ in range(100):
            try:
                if cls.client.get("/api/health").is_success:
                    return
            except httpx.TransportError:
                pass
            if cls.server.poll() is not None:
                break
            time.sleep(0.1)
        cls.server.terminate()
        cls.server.wait(timeout=10)
        cls.log.seek(0)
        message = cls.log.read()
        cls.log.close()
        cls.client.close()
        cls.temp.cleanup()
        raise AssertionError(f"Server did not start:\n{message}")

    @classmethod
    def tearDownClass(cls):
        cls.client.close()
        cls.server.terminate()
        cls.server.wait(timeout=10)
        cls.log.close()
        cls.temp.cleanup()

    def create(self):
        response = self.client.post("/api/projects", json={
            "name": "校对工程", "media_path": str(self.video),
            "subtitle_path": str(self.subtitle),
        })
        self.assertEqual(response.status_code, 201, response.text)
        return response.json()

    def test_preview_create_and_reopen_preserve_plain_subtitles(self):
        preview = self.client.post("/api/imports/preview", json={
            "media_path": str(self.video), "subtitle_path": str(self.subtitle),
        })
        self.assertEqual(preview.status_code, 200, preview.text)
        self.assertEqual(preview.json()["entries"][1]["text"], "[不是人物] 原样保留：正文\n第二行")
        project = self.create()
        reopened = self.client.get(f'/api/projects/{project["id"]}').json()
        self.assertEqual(reopened, project)
        self.assertEqual(project["format_version"], 1)
        self.assertEqual(project["media"]["path"], str(self.video.resolve()))
        self.assertEqual(project["media"]["duration_ms"], 8000)
        entries = project["entries"]
        self.assertEqual([e["start_ms"] for e in entries], [3000, 1000, 1000])
        self.assertEqual(len({e["id"] for e in entries}), 3)
        self.assertEqual(entries[1]["sources"][0]["index"], 9)
        self.assertNotEqual(entries[1]["id"], "9")
        unknown = next(s for s in project["speakers"] if s["label"] == "?")
        self.assertTrue(all(e["speaker_id"] == unknown["id"] for e in entries))
        listing = self.client.get("/api/projects").json()
        self.assertIn(project["id"], [p["id"] for p in listing])
        self.assertEqual(self.subtitle.read_text(encoding="utf-8"), SRT)

    def test_save_reopen_and_export_current_text_in_stable_time_order(self):
        project = self.create()
        entries = project["entries"]
        entries[1]["text"] = "修改后的正文\n仍然保留换行"
        entries[0]["start_ms"] = 4500
        response = self.client.put(f'/api/projects/{project["id"]}', json={
            "revision": project["revision"], "name": project["name"], "entries": entries,
        })
        self.assertEqual(response.status_code, 200, response.text)
        saved = response.json()
        self.assertEqual(saved["revision"], 2)
        reopened = self.client.get(f'/api/projects/{project["id"]}').json()
        self.assertEqual(reopened["entries"], entries)
        output = self.client.post(f'/api/projects/{project["id"]}/exports', json={"revision": saved["revision"]})
        self.assertEqual(output.status_code, 201, output.text)
        exported = output.json()
        expected = "1\n00:00:01,000 --> 00:00:04,000\n修改后的正文\n仍然保留换行\n\n2\n00:00:01,000 --> 00:00:04,000\n同时出现\n\n3\n00:00:04,500 --> 00:00:05,000\n稍后的字幕\n"
        self.assertEqual(Path(exported["export"]["path"]).read_text(encoding="utf-8"), expected)
        self.assertEqual(self.client.get(exported["url"]).text, expected)
        reopened = self.client.get(f'/api/projects/{project["id"]}').json()
        self.assertIn(exported["export"], reopened["exports"])
        self.assertEqual(self.subtitle.read_text(encoding="utf-8"), SRT)

    def test_original_video_supports_browser_byte_range_seeking(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}/media'
        response = self.client.get(url, headers={"Range": "bytes=100-299"})
        self.assertEqual(response.status_code, 206, response.text[:100])
        self.assertEqual(response.headers["accept-ranges"], "bytes")
        self.assertEqual(response.headers["content-range"], f"bytes 100-299/{self.video.stat().st_size}")
        self.assertEqual(response.content, self.video.read_bytes()[100:300])
        suffix = self.client.get(url, headers={"Range": "bytes=-64"})
        self.assertEqual(suffix.content, self.video.read_bytes()[-64:])
        self.assertEqual(self.client.get(url, headers={"Range": "bytes=99999999-"}).status_code, 416)

    def test_open_speaker_labels_save_with_stable_entry_and_special_identities(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        speakers = [{"id": "speaker-kaguya", "label": "Iroha&Kaguya", "color": "#71a8cc", "order": 0}]
        speakers += [dict(s, order=i + 1) for i, s in enumerate(project["speakers"])]
        entries = copy.deepcopy(project["entries"])
        entries[1]["speaker_id"] = "speaker-kaguya"
        entries[2]["speaker_id"] = speakers[2]["id"]
        response = self.client.put(url, json={"revision": 1, "name": project["name"],
                                             "entries": entries, "speakers": speakers})
        self.assertEqual(response.status_code, 200, response.text)
        reopened = self.client.get(url).json()
        self.assertEqual(reopened["speakers"], speakers)
        self.assertEqual(reopened["entries"], entries)
        # Undoing attribution also restores the complete previous speaker configuration.
        response = self.client.put(url, json={"revision": 2, "name": project["name"],
                                             "entries": project["entries"], "speakers": project["speakers"]})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["speakers"], project["speakers"])

    def test_invalid_speakers_cannot_change_special_semantics_or_corrupt_references(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        cases = [[], [project["speakers"][0]]]
        for changes in ({"id": project["speakers"][1]["id"]}, {"label": "NONSPEECH"},
                        {"label": "普通人"}, {"label": " "}, {"order": 1}, {"color": "bad"}):
            speakers = copy.deepcopy(project["speakers"])
            speakers[0].update(changes)
            cases.append(speakers)
        for speakers in cases:
            with self.subTest(speakers=speakers):
                response = self.client.put(url, json={"revision": 1, "name": project["name"],
                                                     "entries": project["entries"], "speakers": speakers})
                self.assertEqual(response.status_code, 422, response.text)
                self.assertIn("speakers", response.json()["error"]["field"])
                self.assertEqual(self.client.get(url).json(), project)

    def test_invalid_import_reports_entry_field_and_never_creates_partial_project(self):
        before = self.client.get("/api/projects").json()
        cases = [
            ("2\n00:00:04,000 --> 00:00:02,000\n反向", "time"),
            ("2\n00:00:08,000 --> 00:00:09,000\n超出原片", "time"),
            ("2\n00:00:02,000 --> 00:00:02,000\n零时长", "time"),
            ("2\n00:00:02,000 --> 00:00:03,000\n   ", "text"),
            ("2\n不是时间\n畸形条目", "time"),
        ]
        bad = self.root / "invalid.srt"
        for block, field in cases:
            with self.subTest(block=block):
                bad.write_text("1\n00:00:00,000 --> 00:00:01,000\n合法条目\n\n" + block, encoding="utf-8")
                body = {"media_path": str(self.video), "subtitle_path": str(bad)}
                for endpoint in ("/api/imports/preview", "/api/projects"):
                    response = self.client.post(endpoint, json=body if endpoint.endswith("preview") else dict(body, name="不应创建"))
                    self.assertEqual(response.status_code, 422, response.text)
                    self.assertEqual(response.json()["error"]["entry"], 2)
                    self.assertEqual(response.json()["error"]["field"], field)
                    self.assertTrue(response.json()["error"]["message"])
                self.assertEqual(self.client.get("/api/projects").json(), before)

    def test_invalid_edits_and_stale_revision_preserve_saved_state(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        for changes in ({"text": " \n "}, {"start_ms": -1}, {"end_ms": 9000},
                        {"end_ms": 3000}, {"start_ms": 1.5}, {"speaker_id": "missing"}):
            with self.subTest(changes=changes):
                entries = copy.deepcopy(project["entries"])
                entries[0].update(changes)
                response = self.client.put(url, json={"revision": project["revision"], "name": project["name"], "entries": entries})
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(response.json()["error"]["entry"], 1)
                self.assertEqual(self.client.get(url).json(), project)
        body = {"revision": project["revision"], "name": project["name"], "entries": project["entries"]}
        saved = self.client.put(url, json=body).json()
        body["entries"][0]["text"] = "较早的请求不应覆盖"
        conflict = self.client.put(url, json=body)
        self.assertEqual(conflict.status_code, 409)
        self.assertEqual(conflict.json()["error"]["code"], "revision_conflict")
        self.assertEqual(self.client.get(url).json(), saved)

    def test_competing_saves_have_one_winner_and_late_old_request_cannot_overwrite(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        bodies = []
        for text in ("并发修改 A", "并发修改 B"):
            entries = copy.deepcopy(project["entries"])
            entries[1]["text"] = text
            bodies.append({"revision": 1, "name": project["name"], "entries": entries})
        with ThreadPoolExecutor(max_workers=2) as pool:
            results = list(pool.map(lambda body: self.client.put(url, json=body), bodies))
        self.assertEqual(sorted(response.status_code for response in results), [200, 409])
        winner = next(response.json() for response in results if response.status_code == 200)
        self.assertEqual(self.client.get(url).json(), winner)
        late = self.client.put(url, json=bodies[0])
        self.assertEqual(late.status_code, 409)
        document = self.workspace / project["id"] / "project.json"
        self.assertEqual(json.loads(document.read_text(encoding="utf-8")), winner)

    @unittest.skipUnless(sys.platform == "win32", "Windows sharing-lock fault injection")
    def test_real_atomic_replace_failure_preserves_complete_file_and_retry_recovers(self):
        # External OS-level fault: readers may open the file, but replacing it is
        # temporarily denied. The real HTTP server/storage path runs unchanged.
        import ctypes
        from ctypes import wintypes

        kernel = ctypes.WinDLL("kernel32", use_last_error=True)
        kernel.CreateFileW.argtypes = [wintypes.LPCWSTR, wintypes.DWORD, wintypes.DWORD,
                                      wintypes.LPVOID, wintypes.DWORD, wintypes.DWORD, wintypes.HANDLE]
        kernel.CreateFileW.restype = wintypes.HANDLE
        kernel.CloseHandle.argtypes = [wintypes.HANDLE]
        kernel.CloseHandle.restype = wintypes.BOOL
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        document = self.workspace / project["id"] / "project.json"
        before = document.read_bytes()
        handle = kernel.CreateFileW(str(document), 0x80000000, 3, None, 3, 0x80, None)
        self.assertNotEqual(handle, wintypes.HANDLE(-1).value, ctypes.get_last_error())
        entries = copy.deepcopy(project["entries"])
        entries[1]["text"] = "磁盘解锁后的最新完整版本"
        body = {"revision": 1, "name": project["name"], "entries": entries}
        try:
            response = self.client.put(url, json=body)
            self.assertEqual(response.status_code, 500, response.text)
            self.assertEqual(response.json()["error"]["code"], "storage_error")
            self.assertEqual(document.read_bytes(), before)
            self.assertEqual(self.client.get(url).json(), project)
            self.assertEqual([p.name for p in document.parent.iterdir()], ["project.json"])
        finally:
            kernel.CloseHandle(handle)
        retried = self.client.put(url, json=body)
        self.assertEqual(retried.status_code, 200, retried.text)
        reopened = self.client.get(url).json()
        self.assertEqual(reopened["revision"], 2)
        self.assertEqual(reopened["entries"], entries)
        self.assertEqual(json.loads(document.read_text(encoding="utf-8")), reopened)

    def test_unknown_version_and_missing_media_are_explicit_and_preserve_document(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        document = self.workspace / project["id"] / "project.json"
        original = document.read_bytes()
        # Inject an externally supplied future-version document, then use HTTP only.
        future = dict(project, format_version=999)
        document.write_text(json.dumps(future, ensure_ascii=False), encoding="utf-8")
        future_bytes = document.read_bytes()
        requests = [
            self.client.get(url),
            self.client.put(url, json={"revision": 1, "name": "覆盖", "entries": project["entries"]}),
            self.client.post(url + "/exports", json={"revision": 1}),
        ]
        for response in requests:
            self.assertEqual(response.status_code, 409, response.text)
            self.assertEqual(response.json()["error"]["code"], "unsupported_version")
        self.assertEqual(document.read_bytes(), future_bytes)
        listing = self.client.get("/api/projects").json()
        self.assertEqual(next(item for item in listing if item["id"] == project["id"])["error"]["code"], "unsupported_version")
        document.write_bytes(original)
        moved = self.video.with_suffix(".moved.mp4")
        self.video.rename(moved)
        try:
            for response in (self.client.get(url), self.client.get(url + "/media"),
                             self.client.put(url, json={"revision": 1, "name": "覆盖", "entries": project["entries"]})):
                self.assertEqual(response.status_code, 404, response.text)
                self.assertEqual(response.json()["error"]["code"], "missing_file")
            self.assertEqual(document.read_bytes(), original)
        finally:
            moved.rename(self.video)

    def test_invalid_stored_subtitle_is_reported_instead_of_being_exported(self):
        project = self.create()
        document = self.workspace / project["id"] / "project.json"
        project["entries"][0]["end_ms"] = -1
        document.write_text(json.dumps(project), encoding="utf-8")
        original = document.read_bytes()
        response = self.client.get(f'/api/projects/{project["id"]}')
        self.assertEqual(response.status_code, 422, response.text)
        self.assertEqual(response.json()["error"]["entry"], 1)
        self.assertEqual(document.read_bytes(), original)

    def test_malformed_save_shape_returns_field_error_and_preserves_project(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        for body in ({"revision": 1, "name": "缺少字幕"},
                     {"revision": 1, "name": "错误字幕类型", "entries": None}):
            with self.subTest(body=body):
                response = self.client.put(url, json=body)
                self.assertEqual(response.status_code, 422, response.text)
                self.assertEqual(response.json()["error"]["field"], "entries")
                self.assertIsNone(response.json()["error"]["entry"])
                self.assertEqual(self.client.get(url).json(), project)

    def test_plain_srt_accepts_bom_crlf_and_extra_separator_lines(self):
        subtitle = self.root / "windows.srt"
        subtitle.write_bytes(("\ufeff8\r\n00:00:01,000 --> 00:00:02,000\r\n  A: 原文  \r\n第二行\r\n\r\n\r\n"
                              "11\r\n00:00:02,000 --> 00:00:03,000\r\n末条\r\n\r\n").encode("utf-8"))
        response = self.client.post("/api/imports/preview", json={
            "media_path": str(self.video), "subtitle_path": str(subtitle),
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual([entry["text"] for entry in response.json()["entries"]], ["  A: 原文  \n第二行", "末条"])


if __name__ == "__main__":
    unittest.main()
