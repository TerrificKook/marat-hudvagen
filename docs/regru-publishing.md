# REG.RU publishing

The workflow validates pull requests without production credentials. Delivery is
restricted to main, the regru-production environment and explicit string flags.
REGRU_DEPLOY_ENABLED and REGRU_AUTO_DEPLOY both start as false. Production
settings and an individual SSH key are provisioned only after owner approval.

Each site must have its own verified document root. The server's independently
verified host key is required; certificate validation is never disabled. A
non-public site marker is provisioned separately after the exact root is checked.
The remote account must provide Python 3.8+ and OpenSSH. One hosting SSH account
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
