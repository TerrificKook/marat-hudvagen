# REG.RU publishing

The workflow validates pull requests without production credentials. Delivery is
restricted to main, the regru-production environment and explicit string flags.
REGRU_DEPLOY_ENABLED and REGRU_AUTO_DEPLOY both start as false. Production
settings and an individual SSH key are provisioned only after owner approval.

Each site must have its own verified document root. The server's independently
verified host key is required; certificate validation is never disabled. A
non-public site marker is provisioned separately after the exact root is checked.
The remote account must provide Python 3.8+. The interpreter is pinned in
public-files.json because the server default python3 is older. The installed
/opt/python/python-3.8.8/bin/python reports Python 3.8.6 in a clean shell.
The runner uses the OpenSSH client; the remote SSH service must be verified separately. One hosting SSH account
can access all sites; separate keys provide revocation, not user isolation.

The deploy engine replaces individual managed files and retains release ZIPs and
backups outside the document root. This method is not globally atomic. Unknown
files and .well-known are preserved. Empty packages, wrong roots, symlinks, missing
settings and archive traversal are rejected. A failed file write restores the
previous managed files. Tests operate only in temporary directories.

On manual workflow_dispatch, rollback_sha accepts a full previously accepted
commit SHA; the same server guards apply. After owner approval, validate a first
manual release, a second automatic release, a manual rollback and restoration.
Public version.json must match the expected SHA over verified HTTPS.

Do not merge the preparation branch before the site's transfer approval. A merge
can also trigger the existing GitHub Pages publishing. Old Pages settings remain
available as part of the rollback plan and are not disabled by this workflow.

Hudwagen keeps its canonical https://www.hudwagen.ru/ address with the exact root
.htaccess in the managed package. In ispmanager, PHP must use FastCGI (Apache)
(tested with PHP 8.4.25), while the panel's domain redirect stays disabled and
HTTP-to-HTTPS stays enabled. No PHP website or application files are published.
The rule preserves the original path and query, excludes the ACME challenge path,
and avoids a redirect through HTTP. Apache applies it to pages and JSON/TXT/XML;
Nginx serves CSS/JS/images directly on either hostname over HTTPS. These assets
remain available without a host redirect. The .htaccess URL itself returns 403.
Only the exact root .htaccess is allowed; nested hidden files, .env, internal
folders and backups remain rejected. Release delivery and rollback manage this
configuration together with the pages. SSL HTTP renewal is verified separately
after the approved DNS switch; initial certificate issuance is not renewal proof.
