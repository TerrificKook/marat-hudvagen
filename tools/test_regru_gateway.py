"""Security boundary and retention tests; no network or real hosting paths."""
import hashlib
import io
import json
import os
from pathlib import Path
import shlex
import tempfile
import time
import unittest
from unittest.mock import patch
import zipfile

import regru_gateway as gate


class Gateway(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.home = Path(self.temp.name).resolve()
        self.domain = 'example.ru'
        self.repo = 'owner/example'
        self.root = self.home / 'www' / self.domain
        self.root.mkdir(parents=True)
        self.state = self.home / '.regru-deploy' / self.domain
        self.state.mkdir(parents=True)
        self.config = b'RewriteEngine On\n'
        self.policy = {'schema': 2, 'domain': self.domain, 'root': str(self.root), 'repo': self.repo,
            'python': '/opt/python/bin/python', 'htaccess_sha256': [hashlib.sha256(self.config).hexdigest()],
            'pinned': ['0' * 40], 'keep_releases': 5, 'keep_backups': 5, 'backup_days': 30}
        (self.state / 'site.json').write_text(json.dumps({'schema': 1, 'domain': self.domain, 'root': str(self.root), 'repo': self.repo}), 'utf-8')
        (self.state / 'gateway-policy.json').write_text(json.dumps(self.policy), 'utf-8')
        self.history = []
        self.add_release(0)
        self.gateway = '/home/account/.regru-deploy/receiver-v2/regru_gateway.py'

    def tearDown(self):
        self.temp.cleanup()

    def bundle(self, sha, extra=None):
        items = {'index.html': 'release-' + sha, '.htaccess': self.config,
                 'version.json': json.dumps({'source_sha': sha, 'repository': self.repo})}
        items.update(extra or {})
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w') as z:
            for k, v in items.items():
                z.writestr(k, v)
        return b.getvalue()

    def add_release(self, number):
        sha = format(number, '040x')
        gate.core.apply(str(self.root), self.domain, self.repo, sha, self.bundle(sha), self.home)
        self.history.append(sha)
        gate.save_json(self.state / 'accepted.json', self.history)
        return sha

    def test_protocol_accepts_only_fixed_argv(self):
        for mode in gate.MODES:
            argv = gate.command(self.policy['python'], self.gateway, self.domain, mode, 'a' * 40)
            self.assertEqual(gate.parse_forced(' '.join(shlex.quote(x) for x in argv), self.policy['python'], self.gateway, self.domain), (mode, 'a' * 40))

    def test_shell_sftp_foreign_site_and_injection_rejected(self):
        valid = ' '.join(gate.command(self.policy['python'], self.gateway, self.domain, 'deploy', 'a' * 40))
        for text in ['', 'id', 'cat ~/.ssh/authorized_keys', 'cat ~/mail/x', 'sftp', 'scp -t /tmp/x',
                     valid.replace(self.domain, 'other.ru'), valid + '; id', valid + ' extra',
                     valid.replace(' -I ', ' -c '), valid.replace('deploy', 'eval'), 'x' * 1025]:
            with self.subTest(text=text), self.assertRaises(ValueError):
                gate.parse_forced(text, self.policy['python'], self.gateway, self.domain)

    def test_fixed_policy_rejects_foreign_root(self):
        p = dict(self.policy, root=str(self.home / 'www' / 'other.ru'))
        gate.save_json(self.state / 'gateway-policy.json', p)
        with self.assertRaises(ValueError):
            gate.policy_context(self.domain, self.home)

    def test_legacy_compatibility_never_executes_source(self):
        source = 'reviewed but never executed source'
        p = dict(self.policy, legacy_code_sha256=hashlib.sha256(source.encode()).hexdigest())
        a = [p['python'], '-c', source, 'deploy', '--root', p['root'], '--domain', self.domain,
             '--repo', self.repo, '--sha', 'a' * 40]
        quote = lambda args: ' '.join(shlex.quote(x) for x in args)
        self.assertEqual(gate.parse_forced(quote(a), p['python'], self.gateway, self.domain, p), ('deploy', 'a' * 40))
        for idx, value in [(2, 'import os; os.system("id")'), (5, '/other'), (7, 'other.ru'), (9, 'owner/other')]:
            b = list(a); b[idx] = value
            with self.assertRaises(ValueError): gate.parse_forced(quote(b), p['python'], self.gateway, self.domain, p)

    def test_site_and_policy_paths_reject_traversal(self):
        for d in ['../mail', '../.ssh', 'example.ru/../../other', '', '..']:
            with self.assertRaises(ValueError):
                gate.policy_context(d, self.home)

    def test_static_config_is_pinned(self):
        gate.validate_static(self.bundle('a' * 40), self.policy)
        with self.assertRaises(ValueError):
            gate.validate_static(self.bundle('a' * 40, {'.htaccess': 'AddHandler application/x-httpd-php .jpg'}), self.policy)

    def test_missing_config_rejected(self):
        b = io.BytesIO()
        with zipfile.ZipFile(b, 'w') as z:
            z.writestr('index.html', 'public')
        with self.assertRaises(ValueError):
            gate.validate_static(b.getvalue(), self.policy)

    def test_server_code_and_double_extensions_rejected(self):
        for n, v in [('x.php.jpg', b'data'), ('x.PHTML.txt', b'data'), ('x.html', b'<?php system(1);'),
                     ('x.html', b'<?=1?>'), ('x.svg', b'<? echo 1; ?>'), ('x.txt', b'<%=1%>'),
                     ('../other/index.html', b'bad'), ('assets/.htaccess', b'bad'), ('.ssh/key.txt', b'bad')]:
            with self.subTest(name=n), self.assertRaises(ValueError):
                gate.validate_static(self.bundle('a' * 40, {n: v}), self.policy)
        gate.validate_static(self.bundle('a' * 40, {'ok.svg': b'<?xml version="1.0"?><svg/>'}), self.policy)
        gate.validate_static(self.bundle('a' * 40, {'ok.woff2': b'\x00random<?<%bytes'}), self.policy)

    def test_retention_protects_current_previous_and_pin(self):
        for i in range(1, 9):
            self.add_release(i)
        record = gate.read_record(self.state)
        plan = gate.retention_plan(self.state, self.policy, record, self.history)
        self.assertEqual(set(plan['keep_releases']), {format(i, '040x') for i in [0, 4, 5, 6, 7, 8]})
        self.assertEqual(len(plan['keep_backups']), 5)
        gate.execute_retention(self.state, plan)
        self.assertEqual(len(list((self.state / 'releases').glob('*.zip'))), 6)
        self.assertEqual(len(list((self.state / 'backups').glob('*.zip'))), 5)

    def test_current_and_previous_survive_even_old_history(self):
        for i in range(1, 9): self.add_release(i)
        r = gate.read_record(self.state)
        r.update(sha='1'.zfill(40), previous_sha='2'.zfill(40))
        p = gate.retention_plan(self.state, self.policy, r, self.history)
        self.assertIn('1'.zfill(40), p['keep_releases'])
        self.assertIn('2'.zfill(40), p['keep_releases'])

    def test_old_backups_expire_and_unknown_files_survive(self):
        b = next((self.state / 'backups').glob('*.zip'))
        old = time.time() - 31 * 86400
        os.utime(b, (old, old))
        unknown = self.state / 'backups' / 'owner-copy.zip'
        unknown.write_bytes(b'owner')
        p = gate.retention_plan(self.state, self.policy, gate.read_record(self.state), self.history)
        self.assertEqual(p['keep_backups'], [])
        gate.execute_retention(self.state, p)
        self.assertTrue(unknown.exists())

    def test_missing_or_corrupt_pin_blocks_cleanup(self):
        pin = self.state / 'releases' / ('0' * 40 + '.zip')
        pin.write_bytes(b'bad')
        with self.assertRaises(zipfile.BadZipFile):
            gate.retention_plan(self.state, self.policy, gate.read_record(self.state), self.history)
        pin.unlink()
        with self.assertRaises(ValueError):
            gate.retention_plan(self.state, self.policy, gate.read_record(self.state), self.history)

    def test_cleanup_changed_file_and_traversal_fail_closed(self):
        for i in range(1, 8): self.add_release(i)
        p = gate.retention_plan(self.state, self.policy, gate.read_record(self.state), self.history)
        candidate = self.state / p['delete'][-1]['path']
        candidate.write_bytes(b'changed')
        before = sorted(str(x) for x in self.state.rglob('*.zip'))
        with self.assertRaises(ValueError): gate.execute_retention(self.state, p)
        self.assertEqual(before, sorted(str(x) for x in self.state.rglob('*.zip')))
        with self.assertRaises(ValueError): gate.execute_retention(self.state, {'delete': [{'path': '../mail/x.zip'}]})

    @unittest.skipIf(os.name == 'nt', 'Linux CI checks POSIX locks and symlinks')
    def test_real_deploy_finalize_rollback_and_retry(self):
        sha = 'a' * 40
        gate.operate(self.domain, 'deploy', sha, self.bundle(sha), self.home)
        self.assertEqual(json.loads((self.state / 'accepted.json').read_text()), ['0' * 40])
        gate.operate(self.domain, 'finalize', sha, home=self.home)
        gate.operate(self.domain, 'deploy', sha, self.bundle(sha), self.home)
        self.assertEqual(gate.read_record(self.state)['previous_sha'], '0' * 40)
        gate.operate(self.domain, 'rollback', '0' * 40, home=self.home)
        gate.operate(self.domain, 'finalize', '0' * 40, home=self.home)
        self.assertEqual(gate.operate(self.domain, 'status', '0' * 40, home=self.home)['verified_files'], 3)
        with self.assertRaises(ValueError): gate.operate(self.domain, 'finalize', sha, home=self.home)

    @unittest.skipIf(os.name == 'nt', 'Linux CI checks POSIX locks and symlinks')
    def test_symlink_archive_cannot_escape(self):
        target = self.state / 'releases' / ('f' * 40 + '.zip')
        target.symlink_to(self.home / 'outside.zip')
        with self.assertRaises(ValueError):
            gate.retention_plan(self.state, self.policy, gate.read_record(self.state), self.history)


if __name__ == '__main__':
    unittest.main()
