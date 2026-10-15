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

    def test_save_as_copies_complete_editing_document_with_independent_project_identity(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        response = self.client.post(url + '/save-as', json={"revision": project["revision"], "name": "独立副本"})
        self.assertEqual(response.status_code, 201, response.text)
        duplicate = response.json()
        self.assertNotEqual(duplicate['id'], project['id'])
        self.assertEqual(duplicate['revision'], 1)
        for key in ('media', 'entries', 'speakers', 'subtitle_sources'):
            self.assertEqual(duplicate[key], project[key])
        self.assertTrue(duplicate['media']['identity'].startswith('sha256:'))
        duplicate['entries'][0]['text'] = '只改副本'
        saved = self.client.put(f'/api/projects/{duplicate["id"]}', json={k: duplicate[k] for k in ('revision', 'name', 'entries', 'speakers', 'subtitle_sources')})
        self.assertEqual(saved.status_code, 200, saved.text)
        self.assertEqual(self.client.get(url).json(), project)
        conflict = self.client.post(url + '/save-as', json={"revision": 0, "name": "过期"})
        self.assertEqual(conflict.status_code, 409)

    def test_explicit_srt_modes_preserve_labels_and_only_consume_known_metadata(self):
        subtitle = self.root / "modes.srt"
        subtitle.write_text("7\n00:00:01,000 --> 00:00:03,000\n[Iroha&Kaguya] {MULTI} {UNKNOWN} {MERGED} 台词: 正文\n第二行\n", encoding="utf-8")
        body = {"media_path": str(self.video), "subtitle_path": str(subtitle)}
        plain = self.client.post("/api/imports/preview", json=body).json()
        self.assertEqual(plain["entries"][0]["text"], "[Iroha&Kaguya] {MULTI} {UNKNOWN} {MERGED} 台词: 正文\n第二行")
        response = self.client.post("/api/imports/preview", json=dict(body, format="speaker-srt"))
        self.assertEqual(response.status_code, 200, response.text)
        parsed = response.json()
        self.assertEqual(parsed["speakers"][0]["label"], "Iroha&Kaguya")
        self.assertEqual(parsed["entries"][0]["tags"], ["MULTI"])
        self.assertEqual(parsed["entries"][0]["text"], "{UNKNOWN} {MERGED} 台词: 正文\n第二行")
        self.assertEqual(parsed["entries"][0]["sources"][0]["source_entries"], [])
        subtitle.write_text("9\n00:00:01,000 --> 00:00:03,000\nS00: 时间: 台词\n换行: 原样\n", encoding="utf-8")
        response = self.client.post("/api/imports/preview", json=dict(body, format="moss-srt"))
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["speakers"][0]["label"], "S00")
        self.assertEqual(response.json()["entries"][0]["text"], "时间: 台词\n换行: 原样")

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
        output = self.client.post(f'/api/projects/{project["id"]}/exports', json={"revision": saved["revision"], "format": "plain-srt"})
        self.assertEqual(output.status_code, 201, output.text)
        exported = output.json()
        expected = "1\n00:00:01,000 --> 00:00:04,000\n修改后的正文\n仍然保留换行\n\n2\n00:00:01,000 --> 00:00:04,000\n同时出现\n\n3\n00:00:04,500 --> 00:00:05,000\n稍后的字幕\n"
        self.assertEqual(Path(exported["export"]["path"]).read_text(encoding="utf-8"), expected)
        self.assertEqual(self.client.get(exported["url"]).text, expected)
        reopened = self.client.get(f'/api/projects/{project["id"]}').json()
        self.assertIn(exported["export"], reopened["exports"])
        self.assertEqual(self.subtitle.read_text(encoding="utf-8"), SRT)

    def test_json_imports_keep_four_distinct_identities_seconds_and_open_labels(self):
        subtitle = self.root / "normalized.jsonl"
        rows = [
            {"idx": 72, "start": 1.2345, "end": 3.456, "speaker": "Iroha&Kaguya", "text": "第一行\n第二行", "tags": ["MULTI", "MERGED"], "source_entries": [91, 0, 91]},
            {"idx": 8, "start": 1.2345, "end": 3.456, "speaker": "NONSPEECH", "text": "笑声"},
            {"idx": 19, "start": 1, "end": 2, "speaker": "OTHER", "text": "原样标签"},
            {"idx": 20, "start": 1, "end": 2, "speaker": "?", "text": "未知"},
        ]
        subtitle.write_text("\ufeff" + "\n\n".join(json.dumps(row, ensure_ascii=False) for row in rows), encoding="utf-8")
        body = {"name": "JSONL", "media_path": str(self.video), "subtitle_path": str(subtitle), "format": "normalized-jsonl"}
        response = self.client.post("/api/projects", json=body)
        self.assertEqual(response.status_code, 201, response.text)
        project = response.json()
        self.assertEqual([s["label"] for s in project["speakers"]], ["Iroha&Kaguya", "OTHER", "?", "NONSPEECH"])
        entry = project["entries"][0]
        self.assertEqual((entry["start_ms"], entry["end_ms"], entry["text"], entry["tags"]), (1234, 3456, "第一行\n第二行", ["MULTI", "MERGED"]))
        self.assertEqual(entry["sources"][0]["index"], 72)
        self.assertEqual(entry["sources"][0]["source_entries"], [91, 0, 91])
        self.assertNotEqual(entry["id"], "72")
        self.assertEqual(project["entries"][1]["sources"][0]["source_entries"], [])
        self.assertEqual(self.client.get(f'/api/projects/{project["id"]}').json(), project)
        moss = self.root / "moss.json"
        moss.write_text(json.dumps([{"id": "seg-72", "start": 1.25, "end": 2.75, "speaker": "S00", "text": "MOSS\n多行"}]), encoding="utf-8")
        response = self.client.post("/api/imports/preview", json={"media_path": str(self.video), "subtitle_path": str(moss), "format": "moss-json"})
        self.assertEqual(response.status_code, 200, response.text)
        parsed = response.json()
        self.assertEqual(parsed["speakers"][0]["label"], "S00")
        source = parsed["entries"][0]["sources"][0]
        self.assertEqual((source["moss_id"], source["index"], source["source_entries"]), ("seg-72", None, []))
        self.assertNotEqual(parsed["entries"][0]["id"], "seg-72")

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

    def test_four_real_exports_keep_source_indices_tags_labels_and_stable_sort(self):
        subtitle = self.root / "export.jsonl"
        rows = [
            {"idx": 90, "start": 3, "end": 4, "speaker": "NONSPEECH", "text": "晚", "source_entries": [77]},
            {"idx": 8, "start": 1.25, "end": 2.75, "speaker": "Iroha&Kaguya", "text": "甲\n乙", "source_entries": [91, 0, 91], "tags": ["MULTI", "MERGED"]},
            {"idx": 7, "start": 1.25, "end": 2.75, "speaker": "?", "text": "同时间", "tags": ["CUSTOM"]},
        ]
        subtitle.write_text("\n".join(json.dumps(row) for row in rows), encoding="utf-8")
        project = self.client.post("/api/projects", json={"name": "四格式", "media_path": str(self.video), "subtitle_path": str(subtitle), "format": "normalized-jsonl"}).json()
        url = f'/api/projects/{project["id"]}'
        outputs = {}
        for format, keep in ((None, False), ("speaker-srt", True), ("plain-srt", False), ("plain-srt", True), ("normalized-jsonl", False), ("moss-json", False)):
            body = {"revision": project["revision"], "keep_tags": keep}
            if format:
                body["format"] = format
            response = self.client.post(url + "/exports", json=body)
            self.assertEqual(response.status_code, 201, response.text)
            result = response.json()
            project = result["project"]
            text = Path(result["export"]["path"]).read_text(encoding="utf-8")
            self.assertEqual(self.client.get(result["url"]).text, text)
            outputs[(format, keep)] = text
        self.assertEqual(outputs[(None, False)], "1\n00:00:01,250 --> 00:00:02,750\n[Iroha&Kaguya] 甲\n乙\n\n2\n00:00:01,250 --> 00:00:02,750\n[?] 同时间\n\n3\n00:00:03,000 --> 00:00:04,000\n[NONSPEECH] 晚\n")
        self.assertIn("[Iroha&Kaguya] {MULTI} {MERGED} 甲\n乙", outputs[("speaker-srt", True)])
        self.assertIn("\n甲\n乙\n", outputs[("plain-srt", False)])
        self.assertNotIn("{MULTI}", outputs[("plain-srt", False)])
        self.assertIn("\n{MULTI} {MERGED} 甲", outputs[("plain-srt", True)])
        exported = [json.loads(line) for line in outputs[("normalized-jsonl", False)].splitlines()]
        self.assertEqual(exported, [dict(rows[1], idx=1), dict(rows[2], idx=2, source_entries=[]), dict(rows[0], idx=3, tags=[])])
        moss = json.loads(outputs[("moss-json", False)])
        self.assertEqual(len({entry["id"] for entry in moss}), 3)
        self.assertEqual([entry["speaker"] for entry in moss], ["Iroha&Kaguya", "?", "NONSPEECH"])
        self.assertEqual(set(moss[0]), {"id", "start", "end", "speaker", "text"})
        # Files can be consumed by the actual production JSONL/SRT public readers.
        from sub._srt_io import parse_jsonl, parse_srt
        tagged_path = Path(project["exports"][1]["path"])
        self.assertEqual(parse_srt(tagged_path)[0].tags, ["MULTI", "MERGED"])
        self.assertEqual(parse_jsonl(Path(project["exports"][4]["path"]))[0].source_entries, [91, 0, 91])
        response = self.client.post("/api/imports/preview", json={"media_path": str(self.video), "subtitle_path": project["exports"][5]["path"], "format": "moss-json"})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["entries"][0]["sources"][0]["source_entries"], [])
        # Later edits and old-revision export attempts cannot mutate already-written output.
        before = outputs[(None, False)]
        entries = copy.deepcopy(project["entries"])
        entries[1]["text"] = "后续修改"
        self.assertEqual(self.client.put(url, json={"revision": project["revision"], "name": project["name"], "entries": entries}).status_code, 200)
        self.assertEqual(self.client.post(url + "/exports", json={"revision": project["revision"]}).status_code, 409)
        self.assertEqual(Path(project["exports"][0]["path"]).read_text(encoding="utf-8"), before)

    def test_preview_applies_complete_replacement_atomically_and_can_restore_previous_sources(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        subtitle = self.root / "replacement.jsonl"
        subtitle.write_text(json.dumps({"idx": 90, "start": 1, "end": 2, "speaker": "新人物", "text": "替换", "source_entries": [900, 2, 900], "tags": ["MULTI"]}), encoding="utf-8")
        response = self.client.post("/api/imports/preview", json={"media_path": str(self.video), "subtitle_path": str(subtitle), "format": "normalized-jsonl"})
        self.assertEqual(response.status_code, 200, response.text)
        preview = response.json()
        self.assertEqual(self.client.get(url).json(), project)
        # Client retains fixed special-track identities when replacing the working set.
        for speaker in preview["speakers"]:
            old = next((s for s in project["speakers"] if s["label"] == speaker["label"]), None)
            if old:
                for entry in preview["entries"]:
                    if entry["speaker_id"] == speaker["id"]:
                        entry["speaker_id"] = old["id"]
                speaker["id"] = old["id"]
        body = {"revision": 1, "name": project["name"], **{key: preview[key] for key in ("entries", "speakers", "subtitle_sources")}}
        invalid = copy.deepcopy(body)
        invalid["entries"][0]["sources"][0]["subtitle_id"] = "missing"
        bad = self.client.put(url, json=invalid)
        self.assertEqual(bad.status_code, 422, bad.text)
        self.assertEqual(self.client.get(url).json(), project)
        applied = self.client.put(url, json=body)
        self.assertEqual(applied.status_code, 200, applied.text)
        for key in ("entries", "speakers", "subtitle_sources"):
            self.assertEqual(applied.json()[key], preview[key])
        restored = self.client.put(url, json={"revision": 2, **{key: project[key] for key in ("name", "entries", "speakers", "subtitle_sources")}})
        self.assertEqual(restored.status_code, 200, restored.text)
        for key in ("entries", "speakers", "subtitle_sources"):
            self.assertEqual(self.client.get(url).json()[key], project[key])

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

    def test_speaker_management_conflicts_are_explicit_and_saves_are_atomic(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        speakers = [
            {"id": "ordinary-a", "label": "Iroha&Kaguya", "color": "#ab1234", "order": 0},
            {"id": "ordinary-b", "label": "同义标签", "color": "#12ab34", "order": 1},
        ] + [dict(s, order=i + 2) for i, s in enumerate(project["speakers"])]
        entries = copy.deepcopy(project["entries"])
        entries[0]["speaker_id"] = "ordinary-a"
        entries[1]["speaker_id"] = "ordinary-b"

        def save(config, items, status=200):
            before = self.client.get(url).json()
            response = self.client.put(url, json={"revision": before["revision"], "name": before["name"],
                                                  "speakers": config, "entries": items})
            self.assertEqual(response.status_code, status, response.text)
            after = self.client.get(url).json()
            if status == 200:
                self.assertEqual(after["speakers"], config)
                self.assertEqual(after["entries"], items)
                self.assertEqual(after["subtitle_sources"], project["subtitle_sources"])
            else:
                self.assertEqual(after, before)
            return response

        save(speakers, entries)
        duplicate = copy.deepcopy(speakers)
        duplicate[0]["label"] = "同义标签"
        response = save(duplicate, entries, 422)
        self.assertEqual(response.json()["error"]["field"], "speakers.1.label")
        self.assertIn("合并", response.json()["error"]["message"])
        # Reject reordering/removing/renaming/replacing special identities, and dangling references.
        for config in (
            [speakers[2], speakers[0], speakers[1], speakers[3]],
            speakers[:-1],
            speakers[:2] + [dict(speakers[2], label="改掉未标注"), speakers[3]],
            speakers[:2] + [dict(speakers[2], id="replacement"), speakers[3]],
            [speakers[0], *speakers[2:]],
        ):
            with self.subTest(config=config):
                save([dict(s, order=i) for i, s in enumerate(config)], entries, 422)
        # Rename/recolor/reorder retain identities, then merge and delete by explicit complete snapshots.
        configured = [dict(speakers[1], order=0), dict(speakers[0], label="新名字", color="#123abc", order=1), *speakers[2:]]
        save(configured, entries)
        merged_entries = [dict(e, speaker_id="ordinary-b") if e["speaker_id"] == "ordinary-a" else e for e in entries]
        merged = [dict(s, order=i) for i, s in enumerate([configured[0], *configured[2:]])]
        save(merged, merged_entries)
        save(configured, entries)  # Restore full identities/configuration/attribution, as undo does.
        unknown = project["speakers"][0]["id"]
        deleted_entries = [dict(e, speaker_id=unknown) if e["speaker_id"] == "ordinary-a" else e for e in entries]
        save(merged, deleted_entries)
        save(speakers, entries)
        self.assertEqual([e["id"] for e in entries], [e["id"] for e in project["entries"]])

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

    def test_structured_errors_are_located_and_never_partially_imported(self):
        project = self.create()
        before = self.client.get("/api/projects").json()
        good = {"idx": 9, "start": 1, "end": 2, "speaker": "?", "text": "有效"}
        bad = self.root / "bad.jsonl"
        cases = [({"start": -0.0001}, "time"), ({"start": 2}, "time"),
                 ({"start": 1.0001, "end": 1.0002}, "time"), ({"end": 8.0001}, "time"),
                 ({"start": float("nan")}, "start"), ({"end": float("inf")}, "end"),
                 ({"start": "1"}, "start"), ({"start": True}, "start"), ({"end": 10 ** 400}, "end"),
                 ({"text": " \n "}, "text"), ({"text": None}, "text"), ({"speaker": ""}, "speaker"),
                 ({"idx": True}, "idx"), ({"tags": "MULTI"}, "tags"), ({"tags": [1]}, "tags"),
                 ({"source_entries": [True]}, "source_entries"), ({"source_entries": [-1]}, "source_entries"),
                 ({"source_entries": [1.2]}, "source_entries")]
        for change, field in cases:
            with self.subTest(change=change):
                bad.write_text(json.dumps(good) + "\n\n" + json.dumps(dict(good, **change)), encoding="utf-8")
                body = {"name": "不能部分导入", "media_path": str(self.video), "subtitle_path": str(bad), "format": "normalized-jsonl"}
                for endpoint in ("/api/imports/preview", "/api/projects"):
                    request = dict(body)
                    if endpoint.endswith("preview"):
                        request.pop("name")
                    response = self.client.post(endpoint, json=request)
                    self.assertEqual(response.status_code, 422, response.text)
                    self.assertEqual(response.json()["error"]["entry"], 3)  # Physical JSONL line, including blank lines.
                    self.assertEqual(response.json()["error"]["field"], field)
        for format, text, entry, field in (
            ("normalized-jsonl", json.dumps(good) + "\n{broken", 2, "json"),
            ("moss-json", '{"segments": []}', None, "json"),
            ("moss-json", '[{"id": 1, "start": 1, "end": 2, "speaker": "S00", "text": "a"}]', 1, "id"),
            ("moss-json", '[null]', 1, "json"),
            ("speaker-srt", '1\n00:00:01,000 --> 00:00:02,000\n无前缀', 1, "speaker"),
            ("moss-srt", '1\n00:00:01,000 --> 00:00:02,000\nS00：正文', 1, "speaker"),
            ("plain-srt", '²\n00:00:01,000 --> 00:00:02,000\n非法序号', 1, "index"),
        ):
            bad.write_text(text, encoding="utf-8")
            response = self.client.post("/api/imports/preview", json={"media_path": str(self.video), "subtitle_path": str(bad), "format": format})
            self.assertEqual(response.status_code, 422, response.text)
            self.assertEqual((response.json()["error"]["entry"], response.json()["error"]["field"]), (entry, field))
        self.assertEqual(self.client.get("/api/projects").json(), before)
        self.assertEqual(self.client.get(f'/api/projects/{project["id"]}').json(), project)

    def test_creation_rejects_changed_source_after_preview_instead_of_importing_unseen_content(self):
        subtitle = self.root / "changing.srt"
        subtitle.write_text(SRT, encoding="utf-8")
        body = {"media_path": str(self.video), "subtitle_path": str(subtitle)}
        response = self.client.post("/api/imports/preview", json=body)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertIn("fingerprint", response.json())
        before = self.client.get("/api/projects").json()
        subtitle.write_text(SRT.replace("稍后的字幕", "未经预览的外部修改"), encoding="utf-8")
        response = self.client.post("/api/projects", json=dict(body, name="必须重新预览", preview_fingerprint=response.json()["fingerprint"]))
        self.assertEqual(response.status_code, 409, response.text)
        self.assertEqual(response.json()["error"]["code"], "source_changed")
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
            self.client.post(url + '/save-as', json={'revision': 1, 'name': '副本'}),
            self.client.post(url + '/relocate', json={'revision': 1, 'media_path': str(self.video)}),
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
            self.assertEqual(self.client.get(url).json(), project)
            self.assertEqual(self.client.get(url + '/media').json()['error']['code'], 'missing_file')
            self.assertEqual(document.read_bytes(), original)
            project['entries'][0]['text'] = '媒体失联时继续编辑'
            saved = self.client.put(url, json={k: project[k] for k in ('revision', 'name', 'entries')})
            self.assertEqual(saved.status_code, 200, saved.text)
            self.assertEqual(saved.json()['entries'], project['entries'])
        finally:
            moved.rename(self.video)

    def test_relocation_verifies_full_content_identity_and_new_media_creates_separate_project(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        moved = self.root / '原片新位置.mp4'
        moved.write_bytes(self.video.read_bytes())
        response = self.client.post(url + '/relocate', json={'revision': 1, 'media_path': str(moved)})
        self.assertEqual(response.status_code, 200, response.text)
        relocated = response.json()
        self.assertEqual(relocated['media']['identity'], project['media']['identity'])
        self.assertEqual(relocated['media']['duration_ms'], 8000)
        self.assertEqual(relocated['entries'], project['entries'])
        self.assertEqual(relocated['media']['path'], str(moved))
        short = self.root / '另一短片.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(self.video), '-t', '2', '-c', 'copy', str(short)], check=True)
        wrong = self.client.post(url + '/relocate', json={'revision': 2, 'media_path': str(short)})
        self.assertEqual(wrong.status_code, 409, wrong.text)
        self.assertEqual(wrong.json()['error']['code'], 'media_identity_mismatch')
        invalid = self.client.post(url + '/new-media', json={'revision': 2, 'name': '短片副本', 'media_path': str(short)})
        self.assertEqual(invalid.status_code, 422, invalid.text)
        self.assertIsNotNone(invalid.json()['error']['entry'])
        self.assertEqual(self.client.get(url).json(), relocated)
        longer = self.root / '另一原片.mp4'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(self.video), '-an', '-c:v', 'copy', str(longer)], check=True)
        created = self.client.post(url + '/new-media', json={'revision': 2, 'name': '新原片工程', 'media_path': str(longer)})
        self.assertEqual(created.status_code, 201, created.text)
        self.assertNotEqual(created.json()['id'], project['id'])
        self.assertNotEqual(created.json()['media']['identity'], project['media']['identity'])
        self.assertEqual(created.json()['entries'], project['entries'])
        self.assertEqual(self.client.get(url).json(), relocated)

    def test_resources_report_missing_changed_and_export_files_without_losing_edits(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        response = self.client.get(url + '/resources')
        self.assertEqual(response.status_code, 200, response.text)
        resources = response.json()
        self.assertEqual(resources['project_id'], project['id'])
        self.assertEqual(resources['media']['status'], 'available')
        self.assertEqual(resources['media']['identity'], project['media']['identity'])
        self.assertEqual(resources['subtitle_sources'][0]['status'], 'available')
        self.assertTrue(Path(resources['working_subtitles']['path']).is_file())
        self.assertEqual(resources['media_artifacts'], [])
        output = self.client.post(url + '/exports', json={'revision': 1}).json()
        exported = self.client.get(url + '/resources').json()['exports'][0]
        self.assertEqual(exported['path'], output['export']['path'])
        self.assertEqual(exported['status'], 'available')
        self.assertEqual(self.client.post(url + '/exports/no-such-export/open-location').status_code, 404)
        # External replacement at the same pathname must not reuse original identity.
        original = self.video.read_bytes()
        try:
            self.video.write_bytes(original + b'changed source')
            self.assertEqual(self.client.get(url + '/resources').json()['media']['status'], 'changed')
            self.assertEqual(self.client.get(url + '/media').json()['error']['code'], 'media_identity_mismatch')
            self.assertEqual(self.client.get(url).json()['entries'], project['entries'])
        finally:
            self.video.write_bytes(original)

    def test_existing_media_cache_references_survive_relocation_but_are_not_shared_by_copies(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        # Ticket 11 now supplies this artifact through the real public generation boundary.
        task = self.client.post(url + '/preview', json={}).json()
        for _ in range(300):
            task = self.client.get(url + '/tasks/' + task['id']).json()
            if task['state'] in ('succeeded', 'failed'):
                break
            time.sleep(.02)
        self.assertEqual(task['state'], 'succeeded', task)
        reference = self.client.get(url).json()['media_artifacts'][0]
        artifact = Path(reference['path'])
        self.assertEqual(self.client.get(url).json()['media_artifacts'], [reference])
        self.assertEqual(self.client.get(url + '/resources').json()['media_artifacts'][0]['status'], 'available')
        moved = self.root / 'cache-relocated.mp4'
        self.video.rename(moved)
        try:
            offline = self.client.get(url + '/resources').json()
            self.assertEqual(offline['media']['status'], 'missing')
            summary = next(item for item in self.client.get('/api/projects').json() if item['id'] == project['id'])
            self.assertTrue(summary['media_missing'])
            self.assertEqual(summary['media']['identity'], project['media']['identity'])
            self.assertEqual(offline['media_artifacts'][0]['status'], 'stale')
            copy_response = self.client.post(url + '/save-as', json={'revision': 1, 'name': '离线副本'})
            self.assertEqual(copy_response.status_code, 201, copy_response.text)
            self.assertEqual(copy_response.json()['entries'], project['entries'])
            self.assertEqual(copy_response.json()['media_artifacts'], [])
            restored = self.client.post(url + '/relocate', json={'revision': 1, 'media_path': str(moved)})
            self.assertEqual(restored.status_code, 200, restored.text)
            self.assertEqual(restored.json()['media_artifacts'], [reference])
            self.assertEqual(self.client.get(url + '/resources').json()['media_artifacts'][0]['status'], 'available')
            self.assertEqual(self.client.post(url + '/relocate', json={'revision': 1, 'media_path': str(moved)}).status_code, 409)
            artifact.unlink()
            self.assertEqual(self.client.get(url + '/resources').json()['media_artifacts'][0]['status'], 'missing')
        finally:
            moved.rename(self.video)

    def test_legacy_identity_is_pinned_before_move_and_missing_legacy_cannot_claim_a_different_original(self):
        project = self.create()
        url = f'/api/projects/{project["id"]}'
        document = self.workspace / project['id'] / 'project.json'
        legacy = copy.deepcopy(project)
        legacy['media'].pop('identity')
        legacy['media'].pop('size_bytes')
        legacy.pop('media_artifacts')
        document.write_text(json.dumps(legacy), encoding='utf-8')
        upgraded = self.client.get(url).json()
        self.assertEqual(upgraded['revision'], 2)
        self.assertEqual(upgraded['media']['identity'], project['media']['identity'])
        self.assertEqual(upgraded['entries'], project['entries'])
        self.assertEqual(json.loads(document.read_text(encoding='utf-8')), upgraded)
        document.write_text(json.dumps(legacy), encoding='utf-8')
        moved = self.root / 'legacy-moved.mp4'
        self.video.rename(moved)
        try:
            self.assertEqual(self.client.get(url).json()['entries'], project['entries'])
            response = self.client.post(url + '/relocate', json={'revision': 1, 'media_path': str(moved)})
            self.assertEqual(response.status_code, 409, response.text)
            self.assertEqual(response.json()['error']['code'], 'media_identity_unknown')
            self.assertEqual(json.loads(document.read_text(encoding='utf-8')), legacy)
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

    def test_project_srt_accepts_production_hour_width_and_arrow_spacing(self):
        subtitle = self.root / "production.srt"
        subtitle.write_text("1\n0:00:01,000-->0:00:02,000\n[先生] {MERGED} 多行\n正文\n", encoding="utf-8")
        response = self.client.post("/api/imports/preview", json={
            "media_path": str(self.video), "subtitle_path": str(subtitle), "format": "speaker-srt",
        })
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["entries"][0]["text"], "多行\n正文")
        self.assertEqual(response.json()["speakers"][0]["label"], "先生")


if __name__ == "__main__":
    unittest.main()
