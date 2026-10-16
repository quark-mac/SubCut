"""Windows delivery failures through the real launcher/CLI, no private mocks."""
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest


class LauncherTests(unittest.TestCase):
    def test_missing_dependencies_explain_install_command(self):
        base = Path(tempfile.gettempdir()) / 'opencode'
        base.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='webui-launch-', dir=base) as directory:
            root = Path(directory)
            subprocess.run([sys.executable, '-m', 'venv', '--without-pip', str(root / 'python')], check=True, timeout=30)
            python = root / 'python' / ('Scripts/python.exe' if os.name == 'nt' else 'bin/python')
            result = subprocess.run([str(python), '-m', 'webui', '--no-browser'], cwd=Path(__file__).resolve().parents[2],
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding='utf-8', errors='replace', timeout=15)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('pip install -r', result.stdout)
            self.assertIn('requirements.txt', result.stdout)
            self.assertNotIn('Traceback', result.stdout)

    def test_unbuilt_frontend_explains_build_without_starting_server(self):
        base = Path(tempfile.gettempdir()) / 'opencode'
        base.mkdir(exist_ok=True)
        with tempfile.TemporaryDirectory(prefix='webui-unbuilt-', dir=base) as directory:
            root = Path(directory)
            (root / 'webui').mkdir()
            shutil.copyfile(Path(__file__).resolve().parents[1] / '__main__.py', root / 'webui/__main__.py')
            result = subprocess.run([sys.executable, '-m', 'webui', '--no-browser'], cwd=root,
                                    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, encoding='utf-8', errors='replace', timeout=15)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('npm ci', result.stdout)
            self.assertIn('npm run build', result.stdout)
            self.assertNotIn('Started server process', result.stdout)


if __name__ == '__main__':
    unittest.main()
