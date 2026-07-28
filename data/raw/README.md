# Raw data archive

Store downloaded raw inputs here only through the local content-addressed archive:

`data/raw/sha256/<digest>/<filename>`

Rules:

- Keep raw inputs out of git.
- Verify upstream checksums before promotion into the archive.
- Do not write directly into `data/releases/`.
- Keep the archive reproducible and offline after acquisition.

