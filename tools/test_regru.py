"""Exercise real file delivery/rollback and rejection cases in temporary sites."""
import io
import os
import shutil
import sys
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch
import zipfile

import deploy_regru as runner
import regru_remote as remote


class Releases(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name) / 'home'
        self.domain = 'example.ru'
        self.repo = 'owner/example'
        self.root = self.home / 'www' / self.domain
        self.root.mkdir(parents=True)
        self.state = self.home / '.regru-deploy' / self.domain
        self.state.mkdir(parents=True)
        (self.state / 'site.json').write_text(json.dumps({'schema': 1, 'domain': self.domain,
            'repo': self.repo, 'root': str(self.root)}), 'utf-8')

    def tearDown(self):
        self.temp.cleanup()

    def bundle(self, sha, extra=None):
        data = {'index.html': 'release-' + sha, 'version.json': json.dumps(
            {'source_sha': sha, 'repository': self.repo})}
        data.update(extra or {})
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as z:
            for name, value in data.items():
                z.writestr(name, value)
        return output.getvalue()

    def deploy(self, sha, extra=None):
        return remote.apply(str(self.root), self.domain, self.repo, sha, self.bundle(sha, extra), self.home)

    def test_release_rollback_and_unknown_files(self):
        service = self.root / '.well-known' / 'acme-challenge'
        service.mkdir(parents=True)
        (service / 'untouched').write_text('challenge')
        (self.root / 'unknown.txt').write_text('unmanaged')
        self.deploy('a' * 40, {'old.css': 'one'})
        self.deploy('b' * 40, {'new.css': 'two'})
        self.assertFalse((self.root / 'old.css').exists())
        self.assertEqual((service / 'untouched').read_text(), 'challenge')
        self.assertEqual((self.root / 'unknown.txt').read_text(), 'unmanaged')
        old = (self.state / 'releases' / ('a' * 40 + '.zip')).read_bytes()
        remote.apply(str(self.root), self.domain, self.repo, 'a' * 40, old, self.home)
        self.assertTrue((self.root / 'old.css').exists())
        self.assertFalse((self.root / 'new.css').exists())
        self.assertIn('a' * 40, (self.root / 'version.json').read_text())
        self.deploy('b' * 40, {'new.css': 'two'})
        self.assertIn('b' * 40, (self.root / 'version.json').read_text())

    def test_root_config_release_and_rollback(self):
        service = self.root / '.well-known' / 'acme-challenge'
        service.mkdir(parents=True)
        (service / 'untouched').write_text('challenge')
        self.deploy('a' * 40, {'.htaccess': 'RewriteEngine On\n# first\n'})
        self.deploy('b' * 40, {'.htaccess': 'RewriteEngine On\n# second\n'})
        old = (self.state / 'releases' / ('a' * 40 + '.zip')).read_bytes()
        remote.apply(str(self.root), self.domain, self.repo, 'a' * 40, old, self.home)
        self.assertEqual((self.root / '.htaccess').read_text(), 'RewriteEngine On\n# first\n')
        self.assertEqual((service / 'untouched').read_text(), 'challenge')

    def test_packager_exact_root_config_only(self):
        project = Path(self.temp.name) / 'package'
        tools = project / 'tools'
        tools.mkdir(parents=True)
        source_tools = Path(__file__).resolve().parent
        for name in ['package_public.py', 'regru_remote.py']:
            shutil.copyfile(source_tools / name, tools / name)
        (project / 'index.html').write_text('<html>public</html>')
        (project / '.htaccess').write_text('RewriteEngine On\n')
        (project / '.env').write_text('do-not-publish')
        hidden = project / 'assets' / '.hidden'
        hidden.mkdir(parents=True)
        (hidden / 'data.txt').write_text('do-not-publish')
        (hidden.parent / '.htaccess').write_text('do-not-publish')
        (hidden.parent / 'ok.css').write_text('body {}')
        (tools / 'public-files.json').write_text(json.dumps({'source': '.',
            'root_files': ['index.html', '.htaccess'], 'dirs': ['assets'], 'repository': self.repo}))
        result = subprocess.run([sys.executable, str(tools / 'package_public.py')],
            env=dict(os.environ, GITHUB_SHA='a' * 40), capture_output=True, text=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        names = {f.relative_to(project / 'dist-regru').as_posix()
            for f in (project / 'dist-regru').rglob('*') if f.is_file()}
        self.assertEqual(names, {'index.html', '.htaccess', 'assets/ok.css', 'version.json'})

    def test_bad_destinations(self):
        for root in ('', '/', str(self.home), str(self.home / 'www'), str(self.home / 'www' / 'other.ru')):
            with self.subTest(root=root), self.assertRaises((ValueError, FileNotFoundError)):
                remote.context(root, self.domain, self.repo, self.home)

    def test_wrong_marker(self):
        with self.assertRaises(ValueError):
            remote.context(str(self.root), self.domain, 'owner/other', self.home)

    def test_bad_archive_paths(self):
        for name in ('../other/index.html', '.env', '.github/workflow.yml', '.well-known/x.txt', 'x//index.html', 'assets/.htaccess', '.hidden/.htaccess', '.htaccess.bak', '.env.txt'):
            with self.subTest(name=name), self.assertRaises(ValueError):
                self.deploy('a' * 40, {name: 'bad'})
        self.assertEqual(list(self.root.iterdir()), [])

    def test_empty_package(self):
        with self.assertRaises((ValueError, zipfile.BadZipFile)):
            remote.apply(str(self.root), self.domain, self.repo, 'a' * 40, b'', self.home)

    def test_failed_build_and_missing_index_cannot_deliver(self):
        script = self.home / 'broken.js'
        script.write_text('const broken = ;', 'utf-8')
        result = subprocess.run(['node', '--check', str(script)], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        self.assertNotEqual(result.returncode, 0)
        with self.assertRaises(ValueError):
            runner.payload(self.root, 'a' * 40, self.repo)
        self.assertEqual(list(self.root.iterdir()), [])

    def test_symlink_destination(self):
        alternate = self.home / 'www' / 'www.example.ru'
        try:
            alternate.symlink_to(self.root, target_is_directory=True)
        except OSError:
            self.skipTest('This Windows account cannot create symlinks; Linux CI will exercise this guard')
        with self.assertRaises(ValueError):
            remote.context(str(alternate), self.domain, self.repo, self.home)

    def test_unknown_overwrite_refused(self):
        (self.root / 'index.html').write_text('unmanaged')
        with self.assertRaises(ValueError):
            self.deploy('a' * 40)
        self.assertEqual((self.root / 'index.html').read_text(), 'unmanaged')

    def test_write_failure_restores_previous_release(self):
        self.deploy('a' * 40, {'old.css': 'one'})
        original = remote.atomic_file
        failed = [False]
        def broken(source, dest):
            if dest.name == 'version.json' and not failed[0]:
                failed[0] = True
                raise OSError('simulated write failure')
            return original(source, dest)
        with patch.object(remote, 'atomic_file', broken), self.assertRaises(OSError):
            self.deploy('b' * 40, {'new.css': 'two'})
        self.assertIn('a' * 40, (self.root / 'version.json').read_text())
        self.assertTrue((self.root / 'old.css').exists())
        self.assertFalse((self.root / 'new.css').exists())
        self.assertEqual(json.loads((self.state / 'current.json').read_text())['sha'], 'a' * 40)

    def test_immutable_collision_before_writes(self):
        self.deploy('a' * 40)
        with self.assertRaises(ValueError):
            self.deploy('a' * 40, {'x.css': 'changed'})
        self.assertFalse((self.root / 'x.css').exists())

    def test_explicit_flags_and_missing_settings(self):
        cfg = {'site_url': 'https://example.ru/', 'domain': 'example.ru'}
        env = {'REGRU_DEPLOY_ENABLED': 'true', 'REGRU_AUTO_DEPLOY': 'true',
            'GITHUB_REF': 'refs/heads/main', 'GITHUB_EVENT_NAME': 'push', 'GITHUB_SHA': 'a' * 40,
            'REGRU_HOST': 'server.example.ru', 'REGRU_PORT': '22', 'REGRU_USER': 'u12345',
            'REGRU_PATH': '/var/www/u12345/data/www/example.ru', 'SITE_URL': cfg['site_url'],
            'REGRU_SSH_PRIVATE_KEY': 'test-only', 'REGRU_KNOWN_HOSTS': 'test-only'}
        runner.settings(env, cfg)
        for key, value in [('REGRU_DEPLOY_ENABLED', 'false'), ('REGRU_AUTO_DEPLOY', 'false'),
                ('GITHUB_REF', 'refs/heads/feature'), ('GITHUB_EVENT_NAME', 'pull_request'),
                ('REGRU_PATH', ''), ('REGRU_SSH_PRIVATE_KEY', '')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                runner.settings(dict(env, **{key: value}), cfg)
        with self.assertRaises(ValueError):
            runner.settings({}, cfg)

    def test_obsolete_main_rejected(self):
        result = subprocess.CompletedProcess([], 0, stdout=(('b' * 40) + '\trefs/heads/main\n').encode(), stderr=b'')
        with patch.object(runner.subprocess, 'run', return_value=result), self.assertRaises(ValueError):
            runner.latest_main('a' * 40, self.repo)


if __name__ == '__main__':
    unittest.main()
