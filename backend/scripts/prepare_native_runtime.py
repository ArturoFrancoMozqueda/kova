"""Assemble the native Python runtime without build/admin/interactive tools.

Run only in Dockerfile.api's Debian builder. Every copied Debian library keeps
its package status and copyright; the final Distroless image retains its own
package inventory. No installed-file or vulnerability metadata is removed.
"""

from __future__ import annotations

import hashlib
import json
import pyexpat
import re
import shutil
import subprocess
import zlib
from pathlib import Path

# Provided by the pinned Distroless base with its own package inventory. Its
# glibc/OpenSSL/zlib ABI matches the Debian 13 builder; everything else required
# by the shipped Python extensions is copied with its actual Debian metadata.
BASE_SONAMES = {
    "libc.so.6", "libm.so.6", "libdl.so.2", "libpthread.so.0", "librt.so.1",
    "libresolv.so.2", "libutil.so.1", "libssl.so.3", "libcrypto.so.3",
    "libz.so.1", "libzstd.so.1",
}
# These extensions support terminal/GUI interaction or libuuid's platform helpers.
# Kova uses uuid4() from Python's os.urandom-backed implementation. Omitting the
# optional _uuid extension retains Python's documented pure-Python fallback.
EXCLUDED_EXTENSIONS = ("_curses", "_curses_panel", "readline", "_uuid", "_tkinter", "_test")


def copy_file(source: Path, target_root: Path) -> None:
    target = target_root / source.relative_to("/")
    target.parent.mkdir(parents=True, exist_ok=True)
    if source.is_symlink():
        target.symlink_to(source.readlink())
    else:
        shutil.copy2(source, target)


def required_packages(stdlib: Path) -> list[str]:
    objects = [Path("/usr/local/bin/python3.12")]
    objects.extend(Path("/usr/local/lib/python3.12/lib-dynload") / p.name
                   for p in (stdlib / "lib-dynload").glob("*.so"))
    for path in Path("/app/.venv/lib").rglob("*"):
        if path.is_file() and ".so" in path.name:
            with path.open("rb") as stream:
                if stream.read(4) == b"\x7fELF":
                    objects.append(path)
    # Wheel entrypoints supply RPATHs for their private, hash-named libraries.
    # Analyzing a nested library alone loses that caller context; expose those
    # *actual installed directories* to ldd so its closure matches wheel loading.
    # Missing files still fail below; no unresolved dependency is ignored.
    vendor_dirs = {str(path.parent) for path in objects if str(path).startswith("/app/")}
    loader_path = ":".join(["/usr/local/lib", *sorted(vendor_dirs)])
    result = subprocess.run(
        ["ldd", *map(str, objects)], check=True, capture_output=True, text=True,
        env={"PATH": "/usr/bin:/bin", "LC_ALL": "C", "LD_LIBRARY_PATH": loader_path},
    ).stdout
    if "not found" in result:
        missing = []
        current = "python3.12"
        for line in result.splitlines():
            if line.endswith(":"):
                current = line[:-1]
            if "not found" in line:
                missing.append(f"{current}: {line.strip()}")
        raise RuntimeError("Builder contains an unresolved ELF dependency: " + "; ".join(missing))
    libraries = set(re.findall(r"^\s*\S+ => (/\S+) \(", result, flags=re.MULTILINE))
    packages = set()
    for value in sorted(libraries):
        source = Path(value)
        if source.name in BASE_SONAMES or value.startswith(("/app/", "/usr/local/")):
            continue
        # Debian's merged-/usr layout can report /lib while dpkg records /usr/lib.
        aliases = {value, str(source.resolve())}
        if value.startswith("/lib/"):
            aliases.add("/usr" + value)
        owners = subprocess.run(["dpkg-query", "--search", *sorted(aliases)],
                                capture_output=True, text=True).stdout
        if not owners.strip():
            raise RuntimeError(f"Unowned native library: {value}")
        for line in owners.splitlines():
            packages.add(line.split(": ", 1)[0].split(":", 1)[0])
    return sorted(packages)


def assemble(destination: Path) -> None:
    destination.mkdir(parents=True)
    for executable in ("python3.12", "python3", "python"):
        copy_file(Path("/usr/local/bin") / executable, destination)
    copy_file(Path("/usr/local/lib/libpython3.12.so.1.0"), destination)
    stdlib = destination / "usr/local/lib/python3.12"
    shutil.copytree(
        "/usr/local/lib/python3.12", stdlib,
        ignore=shutil.ignore_patterns("site-packages", "__pycache__", "test", "tests",
                                     "ensurepip", "idlelib", "tkinter", "turtledemo"),
    )
    excluded = []
    for extension in (stdlib / "lib-dynload").glob("*.so"):
        if extension.name.startswith(EXCLUDED_EXTENSIONS):
            excluded.append(extension.name)
            extension.unlink()
    packages = []
    for package in required_packages(stdlib):
        status = subprocess.run(["dpkg-query", "--status", package], check=True,
                                capture_output=True, text=True).stdout
        files = subprocess.run(["dpkg-query", "--listfiles", package], check=True,
                               capture_output=True, text=True).stdout.splitlines()
        copied = []
        for name in files:
            source = Path(name)
            if not (source.is_file() or source.is_symlink()):
                continue
            if ".so" in source.name or source.name == "copyright":
                copy_file(source, destination)
                copied.append(name)
        # Some runtime packages point their documentation directory at their
        # source package's shared copyright file; dpkg -L lists only that symlink.
        copyright_file = Path("/usr/share/doc") / package / "copyright"
        if copyright_file.is_file() and str(copyright_file) not in copied:
            copy_file(copyright_file, destination)
            copied.append(str(copyright_file))
        if not copied:
            raise RuntimeError(f"No runtime libraries found for {package}")
        metadata = destination / "var/lib/dpkg/status.d" / f"{package}_status"
        metadata.parent.mkdir(parents=True, exist_ok=True)
        metadata.write_text(status)
        file_list = destination / "var/lib/dpkg/info" / f"{package}.list"
        file_list.parent.mkdir(parents=True, exist_ok=True)
        file_list.write_text("\n".join(copied) + "\n")
        packages.append({"name": package, "files": copied,
                         "status": str(metadata.relative_to(destination)),
                         "sha256": {name: hashlib.sha256(Path(name).read_bytes()).hexdigest()
                                    for name in copied}})
    provenance = destination / "usr/share/kova/native-runtime.json"
    provenance.parent.mkdir(parents=True, exist_ok=True)
    provenance.write_text(json.dumps({
        "python": subprocess.run(["python3.12", "--version"], check=True,
                                 capture_output=True, text=True).stdout.strip(),
        "embedded_expat": pyexpat.EXPAT_VERSION,
        "zlib_runtime": zlib.ZLIB_RUNTIME_VERSION,
        "debian_libraries": packages,
        "excluded_extensions": sorted(excluded),
    }, indent=2) + "\n")
    account = destination / "etc"
    account.mkdir(parents=True, exist_ok=True)
    (account / "passwd").write_text(
        "root:x:0:0:root:/root:/sbin/nologin\n"
        "kova:x:10001:10001:Kova:/nonexistent:/sbin/nologin\n"
    )
    (account / "group").write_text("root:x:0:\nkova:x:10001:\n")


if __name__ == "__main__":
    assemble(Path("/native-runtime"))
