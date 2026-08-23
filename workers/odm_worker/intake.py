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

# How many bytes of imagery one job may pull in, across the ZIP or every photo
# in a manifest.
#
# THIS EXISTS BECAUSE THE WORKER SHARES A DISK WITH NodeODM. Without a ceiling,
# any non-viewer workspace member could paste a URL pointing at an endless
# stream, a multi-hundred-gigabyte file, or a zip bomb, and fill the volume that
# every reconstruction on this host writes to — taking the whole aerial lane
# down, with no failed job to point at. The sibling `ocr_worker` refuses exactly
# this on its own intake seam, and the app-side custody pass already enforces
# `resolveAerialArtifactMaxBytes` on its stream; this is the same rule at the
# one hop that had none.
#
# 40 GiB is deliberately generous — a real corridor survey is thousands of
# 8-12 MB frames — because the point is to stop the unbounded case, not to
# second-guess a planner's flight.
DEFAULT_MAX_SOURCE_BYTES = 40 * 1024 * 1024 * 1024


def resolve_max_source_bytes(environ=None):
    """The imagery ceiling for this worker, from ODM_WORKER_MAX_SOURCE_BYTES."""
    source = os.environ if environ is None else environ
    raw = str(source.get("ODM_WORKER_MAX_SOURCE_BYTES", "")).strip()
    if not raw:
        return DEFAULT_MAX_SOURCE_BYTES
    try:
        value = int(raw)
    except ValueError:
        return DEFAULT_MAX_SOURCE_BYTES
    # A zero or negative ceiling would mean "refuse everything", which is never
    # what an operator setting this meant; treat it as unset rather than
    # bricking intake in a way that looks like a network fault.
    return value if value > 0 else DEFAULT_MAX_SOURCE_BYTES


class IntakeError(Exception):
    """A named intake failure whose message is safe to send in a callback."""


def default_fetcher(url, dest_path, max_bytes=None, timeout=300):
    """Stream `url` to `dest_path`, refusing past `max_bytes`; returns bytes
    written. http(s) only."""
    if not (url.startswith("https://") or url.startswith("http://")):
        raise IntakeError(f"imagery URL is not http(s): {url[:80]}")
    ceiling = resolve_max_source_bytes() if max_bytes is None else max_bytes
    request = urllib.request.Request(url, headers={"User-Agent": "openplan-odm-worker"})
    written = 0
    with urllib.request.urlopen(request, timeout=timeout) as response, open(
        dest_path, "wb"
    ) as out:
        while True:
            chunk = response.read(_DOWNLOAD_CHUNK)
            if not chunk:
                break
            written += len(chunk)
            if written > ceiling:
                # Stop READING. A ceiling checked after the fact spends the disk
                # first and complains about it afterwards, which is the failure
                # being prevented rather than a report of it.
                raise IntakeError(
                    f"the imagery at {url[:80]} is larger than this worker's ceiling of "
                    f"{ceiling} bytes (ODM_WORKER_MAX_SOURCE_BYTES). Nothing was processed."
                )
            out.write(chunk)
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


def _extract_zip_safely(zip_path, dest_dir, max_total_bytes=None):
    """Extract, refusing entries that would escape dest_dir (zip-slip) and
    stopping once the extracted total would pass `max_total_bytes`.

    THE SIZE CAP IS SEPARATE FROM THE DOWNLOAD CEILING ON PURPOSE. A ZIP that
    is small on the wire can expand to any size at all — the archive format
    permits ratios in the thousands — so a download limit says nothing about
    what lands on the disk. This counts what is actually written, chunk by
    chunk, rather than trusting the entry headers: a header is written by
    whoever made the archive, and the whole hazard is an archive nobody here
    made.
    """
    ceiling = resolve_max_source_bytes() if max_total_bytes is None else max_total_bytes
    extracted = 0
    written_total = 0
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
                while True:
                    chunk = src.read(_DOWNLOAD_CHUNK)
                    if not chunk:
                        break
                    written_total += len(chunk)
                    if written_total > ceiling:
                        raise IntakeError(
                            "the imagery ZIP expands to more than this worker's ceiling of "
                            f"{ceiling} bytes (ODM_WORKER_MAX_SOURCE_BYTES). Nothing was "
                            "processed."
                        )
                    out.write(chunk)
            extracted += 1
    return extracted


def prepare_imagery(imagery, work_dir, fetcher=default_fetcher, max_bytes=None):
    """Materialize the request's imagery under work_dir; returns the directory
    holding the images. Raises IntakeError with a sendable message.

    `max_bytes` is the ceiling for the WHOLE job — the ZIP and its expansion, or
    every photo in a manifest added together. A per-file limit would let a
    manifest of ten thousand acceptable photos fill the same disk.
    """
    images_dir = os.path.join(work_dir, "images")
    os.makedirs(images_dir, exist_ok=True)
    ceiling = resolve_max_source_bytes() if max_bytes is None else max_bytes
    remaining = ceiling

    imagery_type = imagery.get("type")

    if imagery_type == "zip_url":
        zip_path = os.path.join(work_dir, "imagery.zip")
        try:
            fetcher(imagery["url"], zip_path, ceiling)
        except IntakeError:
            raise
        except Exception as exc:  # noqa: BLE001 - the cause goes in the message
            raise IntakeError(f"the imagery ZIP could not be downloaded: {exc}") from exc
        try:
            _extract_zip_safely(zip_path, images_dir, ceiling)
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
                # The remaining budget, not the whole ceiling: ten thousand
                # individually acceptable photos fill a disk exactly as well as
                # one enormous file.
                written = fetcher(photo["url"], dest, remaining)
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

            remaining -= actual_size
            if remaining < 0:
                raise IntakeError(
                    "the photo manifest totals more than this worker's ceiling of "
                    f"{ceiling} bytes (ODM_WORKER_MAX_SOURCE_BYTES). Nothing was processed."
                )

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
