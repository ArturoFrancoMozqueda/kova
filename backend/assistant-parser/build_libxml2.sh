#!/bin/sh
set -eu

mkdir /xml-source
tar -xf /xml-source.tar.xz --strip-components=1 -C /xml-source
python - <<'PY'
import hashlib
import json
import subprocess
from pathlib import Path

patches = Path('/xml-patches')
records = json.loads((patches / 'provenance.json').read_text())
expected = {'CVE-2026-86138', 'CVE-2026-86139', 'CVE-2026-86140',
            'CVE-2026-86142', 'CVE-2026-86143', 'CVE-2026-86144'}
if len(records) != len(expected) or {record['cve'] for record in records} != expected:
    raise ValueError('The complete six-CVE patch manifest is required')
if {path.stem for path in Path('/xml-tests').glob('CVE-*.c')} != expected:
    raise ValueError('Every patched CVE requires its corresponding executable regression')
for record in records:
    original = patches / (record['cve'] + '.patch')
    assert hashlib.sha256(original.read_bytes()).hexdigest() == record['sha256']
    selected = patches / record.get('backport_file', original.name)
    expected = record.get('backport_sha256', record['sha256'])
    assert hashlib.sha256(selected.read_bytes()).hexdigest() == expected
    subprocess.run(['patch', '--batch', '--fuzz=0', '-p1', '-d', '/xml-source',
                    '-i', str(selected)], check=True)
PY

configure() {
    cmake -S /xml-source -B "$1" -G Ninja \
        -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr -DCMAKE_INSTALL_LIBDIR=lib \
        -DBUILD_SHARED_LIBS="$2" -DLIBXML2_WITH_TESTS="$3" -DLIBXML2_WITH_PROGRAMS="$3" \
        -DLIBXML2_WITH_PYTHON=OFF -DLIBXML2_WITH_LZMA=ON -DLIBXML2_WITH_ZLIB=ON \
        -DLIBXML2_WITH_HTTP=ON -DLIBXML2_WITH_FTP=ON -DLIBXML2_WITH_LEGACY=ON
}

configure /xml-static OFF ON
cmake --build /xml-static --parallel 2
mkdir -p /xml-package/usr/share/kova-parser/libxml2/tests
ctest --test-dir /xml-static --output-on-failure --no-tests=error \
    --output-junit /xml-package/usr/share/kova-parser/libxml2/tests/upstream.xml
: > /xml-static/backports-passed.txt
for test_source in /xml-tests/CVE-*.c; do
    test_name=$(basename "$test_source" .c)
    cc -O0 -g -I/xml-static -I/xml-source/include -I/xml-source \
        "$test_source" /xml-static/libxml2.a -lz -llzma -lm -lpthread -ldl \
        -o "/xml-static/$test_name"
    "/xml-static/$test_name"
    printf '%s\n' "$test_name" >> /xml-static/backports-passed.txt
    printf '%s\n' "PASS: $test_name"
done
python - <<'PY'
import json
from pathlib import Path

expected = {record['cve'] for record in json.loads(Path('/xml-patches/provenance.json').read_text())}
passed = Path('/xml-static/backports-passed.txt').read_text().splitlines()
if len(passed) != len(expected) or set(passed) != expected:
    raise ValueError('The complete six-CVE regression set did not execute successfully')
result = {'regressions': len(passed), 'passed': passed, 'failures': 0, 'skipped': 0}
Path('/xml-package/usr/share/kova-parser/libxml2/tests/backports.json').write_text(
    json.dumps(result, indent=2) + '\n')
PY

configure /xml-shared ON OFF
cmake --build /xml-shared --parallel 2
DESTDIR=/xml-package cmake --install /xml-shared
mkdir -p /xml-package/usr/share/licenses/libxml2
cp /xml-source/Copyright /xml-package/usr/share/licenses/libxml2/Copyright
cp -R /xml-patches /xml-package/usr/share/kova-parser/libxml2/patches
cp /xml-tests/CVE-*.c /xml-package/usr/share/kova-parser/libxml2/tests/
python - <<'PY'
import hashlib
import json
from pathlib import Path

base = Path('/xml-package/usr/share/kova-parser/libxml2')
library = Path('/xml-package/usr/lib/libxml2.so.2.13.9')
metadata = {
    'name': 'libxml2', 'version': '2.13.9-r2',
    'build': 'Kova source build with six security backports; not an Alpine release',
    'source_url': 'https://download.gnome.org/sources/libxml2/2.13/libxml2-2.13.9.tar.xz',
    'source_sha256': 'a2c9ae7b770da34860050c309f903221c67830c86e4a7e760692b803df95143a',
    'library_sha256': hashlib.sha256(library.read_bytes()).hexdigest(),
    'patches': json.loads((base / 'patches/provenance.json').read_text()),
    'python_bindings': False,
    'scanner_note': 'The upstream/package version is deliberately unchanged. See explicit patch provenance and test reports rather than inferring fixes from a higher version or an empty OS advisory feed.',
}
(base / 'provenance.json').write_text(json.dumps(metadata, indent=2) + '\n')
PY
# Preserve truthful package inventory. No invented fixed upstream/Alpine version.
apk mkpkg --files /xml-package --output /libxml2-patched.apk \
    --info name:libxml2 --info version:2.13.9-r2 --info "arch:$(apk --print-arch)" \
    --info origin:libxml2 --info license:MIT --info maintainer:Kova \
    --info 'description:XML library 2.13.9 with Kova security backports (see packaged provenance)' \
    --info url:https://gitlab.gnome.org/GNOME/libxml2 \
    --info 'depends:musl so:libz.so.1 so:liblzma.so.5' \
    --info 'provides:so:libxml2.so.2=2.13.9' \
    --info tags:kova:security-backports
