"""Imagery intake: turn a ProcessingRequest's imagery into a directory of photos.

Two shapes, per the contract:
  * zip_url (v1): one signed link to a ZIP of source images. Downloaded,
    extracted with zip-slip protection, and swept for image files.
  * photo_manifest (v1.1): signed per-photo links. Each file is downloaded and,
    when the manifest carries them, verified against its declared byte size and
    SHA-256 — a mismatch FAILS the job naming the file, because the photos are
    source evidence and a silently corrupted download would flow into an
    orthomosaic nobody could distrust.

Stdlib only (urllib), with the fetcher injectable so the test suite can serve
fixtures from a local socket without any dependency.
"""

import hashlib
import os
import re
import shutil
import urllib.request
import zipfile

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".tif", ".tiff"}

_DOWNLOAD_CHUNK = 1024 * 1024


class IntakeError(Exception):
    """A named intake failure whose message is safe to send in a callback."""


def default_fetcher(url, dest_path, timeout=300):
    """Stream `url` to `dest_path`; returns bytes written. http(s) only."""
    if not (url.startswith("https://") or url.startswith("http://")):
        raise IntakeError(f"imagery URL is not http(s): {url[:80]}")
    request = urllib.request.Request(url, headers={"User-Agent": "openplan-odm-worker"})
    written = 0
    with urllib.request.urlopen(request, timeout=timeout) as response, open(
        dest_path, "wb"
    ) as out:
        while True:
            chunk = response.read(_DOWNLOAD_CHUNK)
            if not chunk:
                break
            out.write(chunk)
            written += len(chunk)
    return written


def sanitize_filename(filename, index):
    """Keep the basename only; a manifest filename is data, not a path."""
    base = os.path.basename(filename.replace("\\", "/")).strip()
    base = re.sub(r"[^A-Za-z0-9._-]", "_", base)
    if not base or base.startswith("."):
        base = f"photo_{index:05d}"
    return f"{index:05d}_{base}"


def _sha256_of(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(_DOWNLOAD_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def collect_images(root):
    found = []
    for dirpath, _dirnames, filenames in os.walk(root):
        for name in filenames:
            if os.path.splitext(name)[1].lower() in IMAGE_EXTENSIONS:
                found.append(os.path.join(dirpath, name))
    return sorted(found)


def _extract_zip_safely(zip_path, dest_dir):
    """Extract, refusing entries that would escape dest_dir (zip-slip)."""
    extracted = 0
    with zipfile.ZipFile(zip_path) as archive:
        for info in archive.infolist():
            if info.is_dir():
                continue
            target = os.path.join(dest_dir, info.filename)
            resolved = os.path.realpath(target)
            if not resolved.startswith(os.path.realpath(dest_dir) + os.sep):
                # A hostile or malformed entry; skip it by name rather than
                # writing outside the working directory.
                continue
            os.makedirs(os.path.dirname(resolved), exist_ok=True)
            with archive.open(info) as src, open(resolved, "wb") as out:
                shutil.copyfileobj(src, out)
            extracted += 1
    return extracted


def prepare_imagery(imagery, work_dir, fetcher=default_fetcher):
    """Materialize the request's imagery under work_dir; returns the directory
    holding the images. Raises IntakeError with a sendable message."""
    images_dir = os.path.join(work_dir, "images")
    os.makedirs(images_dir, exist_ok=True)

    imagery_type = imagery.get("type")

    if imagery_type == "zip_url":
        zip_path = os.path.join(work_dir, "imagery.zip")
        try:
            fetcher(imagery["url"], zip_path)
        except IntakeError:
            raise
        except Exception as exc:  # noqa: BLE001 - the cause goes in the message
            raise IntakeError(f"the imagery ZIP could not be downloaded: {exc}") from exc
        try:
            _extract_zip_safely(zip_path, images_dir)
        except zipfile.BadZipFile as exc:
            raise IntakeError("the downloaded file is not a readable ZIP archive") from exc
        images = collect_images(images_dir)
        if not images:
            raise IntakeError(
                "the imagery ZIP contained no image files "
                f"(looked for {', '.join(sorted(IMAGE_EXTENSIONS))})"
            )
        return images_dir

    if imagery_type == "photo_manifest":
        photos = imagery.get("photos", [])
        for index, photo in enumerate(photos):
            name = sanitize_filename(photo.get("filename", ""), index)
            dest = os.path.join(images_dir, name)
            try:
                written = fetcher(photo["url"], dest)
            except IntakeError:
                raise
            except Exception as exc:  # noqa: BLE001
                raise IntakeError(
                    f"photo '{photo.get('filename', name)}' could not be downloaded: {exc}"
                ) from exc

            declared_size = photo.get("sizeBytes")
            if isinstance(declared_size, int):
                actual_size = os.path.getsize(dest)
                if actual_size != declared_size:
                    raise IntakeError(
                        f"photo '{photo.get('filename', name)}' downloaded {actual_size} bytes "
                        f"but the manifest declared {declared_size} — refusing to process "
                        "imagery that does not match its manifest"
                    )
            else:
                actual_size = written

            checksum = photo.get("checksumSha256")
            if checksum:
                actual = _sha256_of(dest)
                if actual != checksum:
                    raise IntakeError(
                        f"photo '{photo.get('filename', name)}' failed its SHA-256 check "
                        f"(manifest {checksum[:12]}…, downloaded {actual[:12]}…) — refusing "
                        "to process imagery that does not match its manifest"
                    )
        images = collect_images(images_dir)
        if not images:
            raise IntakeError("the photo manifest produced no image files")
        return images_dir

    raise IntakeError(f"unknown imagery type: {imagery_type!r}")
