"""Seven-day project recycle bin. Move owned directories, never source-file references."""
from datetime import datetime, timezone
import json
import shutil
import time

from .errors import Problem
from .storage import Store, atomic_write


RETENTION_SECONDS = 7 * 24 * 60 * 60


class RecycleBin:
    def __init__(self, store: Store):
        self.store = store
        self.root = store.root / '.trash'

    def folder(self, project_id):
        self.store.directory(project_id)  # Canonical UUID validation.
        return self.root / project_id

    def receipt(self, folder):
        if folder.is_symlink() or (hasattr(folder, 'is_junction') and folder.is_junction()):
            raise ValueError('linked recycle folder')
        data = json.loads((folder / 'receipt.json').read_text(encoding='utf-8'))
        if data['id'] != folder.name or not isinstance(data['name'], str):
            raise ValueError('invalid recycle identity')
        if type(data['deleted_at']) not in (float, int) or not 0 < data['deleted_at'] < float('inf'):
            raise ValueError('invalid deletion time')
        self.folder(data['id'])
        return data

    def summary(self, receipt):
        def iso(seconds):
            return datetime.fromtimestamp(seconds, timezone.utc).isoformat()
        return {**receipt, 'deleted_at': iso(receipt['deleted_at']),
                'expires_at': iso(receipt['deleted_at'] + RETENTION_SECONDS)}

    def discard(self, project):
        """Caller holds tasks.lock then store.lock and has checked revision/activity."""
        folder = self.folder(project.id)
        self.root.mkdir(parents=True, exist_ok=True)
        if folder.exists():
            raise Problem('回收站已有同身份工程，请先恢复或等待清理', status=409, code='trash_conflict')
        folder.mkdir()
        receipt = {'id': project.id, 'name': project.name, 'deleted_at': time.time()}
        try:
            atomic_write(folder / 'receipt.json', json.dumps(receipt, ensure_ascii=False))
            self.store.directory(project.id).rename(folder / 'project')
        except OSError:
            shutil.rmtree(folder)
            raise
        return self.summary(receipt)

    def listing(self):
        with self.store.lock:
            self.cleanup()
            result = []
            for folder in self.root.iterdir() if self.root.exists() else []:
                try:
                    receipt = self.receipt(folder)
                    if time.time() < receipt['deleted_at'] + RETENTION_SECONDS and (folder / 'project' / 'project.json').is_file():
                        result.append(self.summary(receipt))
                except (OSError, ValueError, KeyError, TypeError, OverflowError, Problem):
                    continue
            return sorted(result, key=lambda item: item['deleted_at'], reverse=True)

    def restore(self, project_id):
        with self.store.lock:
            self.cleanup()
            folder = self.folder(project_id)
            try:
                receipt = self.receipt(folder)
            except (OSError, ValueError, KeyError, TypeError) as exc:
                raise Problem('回收站中找不到工程，可能已到期清理', status=404, code='trash_not_found') from exc
            if time.time() >= receipt['deleted_at'] + RETENTION_SECONDS:
                raise Problem('工程已超过回收保留期，正在等待清理', status=404, code='trash_not_found')
            destination = self.store.directory(project_id)
            if destination.exists():
                raise Problem('已有同身份工程，无法覆盖恢复', status=409, code='project_exists')
            document = folder / 'project' / 'project.json'
            # Invalidate old tabs' revisions; cache/export absolute paths become valid again after moving back.
            try:
                data = json.loads(document.read_text(encoding='utf-8'))
                if not isinstance(data, dict) or data.get('id') != receipt['id'] or type(data.get('revision')) is not int:
                    raise ValueError('invalid project identity or revision')
            except (ValueError, FileNotFoundError) as exc:
                raise Problem('回收工程文件损坏，原文件保留', status=422, code='invalid_project') from exc
            data['revision'] += 1
            atomic_write(document, json.dumps(data, ensure_ascii=False, indent=2))
            (folder / 'project').rename(destination)
            (folder / 'receipt.json').unlink(missing_ok=True)
            folder.rmdir()
            return {'id': project_id, 'restored': True}

    def cleanup(self):
        with self.store.lock:
            for folder in self.root.iterdir() if self.root.exists() else []:
                try:
                    receipt = self.receipt(folder)
                    if time.time() >= receipt['deleted_at'] + RETENTION_SECONDS:
                        # Keep the expiry receipt until all payload files are gone, so an
                        # interrupted purge (e.g. a Windows sharing lock) can retry later.
                        payload = folder / 'project'
                        if payload.exists():
                            shutil.rmtree(payload)
                        (folder / 'receipt.json').unlink(missing_ok=True)
                        folder.rmdir()
                except (OSError, ValueError, KeyError, TypeError, Problem):
                    # Leave incomplete/corrupt records for recovery; transient OS locks retry next sweep.
                    continue
