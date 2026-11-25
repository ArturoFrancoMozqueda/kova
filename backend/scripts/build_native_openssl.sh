#!/bin/sh
set -eu

package=3.5.9-1~deb13u1
dpkg-source -x "openssl_$package.dsc" source
multiarch=$(dpkg-architecture -qDEB_HOST_MULTIARCH)
arch=$(dpkg --print-architecture)
export DEB_BUILD_MAINT_OPTIONS='hardening=+all future=+lfs'
eval "$(dpkg-buildflags --export=sh)"
export CPPFLAGS CFLAGS LDFLAGS

mkdir build runtime
cd build
# Match Debian's shared-library configuration, with QUIC compiled out.
../source/Configure "debian-$arch" shared no-quic no-tests \
    --prefix=/usr --openssldir=/usr/lib/ssl --libdir="lib/$multiarch" \
    no-idea no-mdc2 no-rc5 no-ssl3 no-ssl3-method enable-rfc3779 enable-cms \
    no-capieng no-rdrand enable-tfo enable-zstd enable-zlib enable-fips \
    enable-unit-test enable-ec_nistp_64_gcc_128
make -j"$(nproc)" build_generated
make -j"$(nproc)" libssl.so.3
grep -Eq '^# *define OPENSSL_NO_QUIC' include/openssl/configuration.h
nm --defined-only libssl.so.3 > ssl-symbols.txt
# TLS callback APIs can remain available for external transport implementations.
if grep -Eq ' (OSSL_QUIC_[[:alnum:]_]+|ossl_quic_channel_[[:alnum:]_]+|SSL_inject_net_dgram)(@|$)' ssl-symbols.txt; then
    printf '%s\n' 'Unexpected built-in QUIC transport in the native OpenSSL build' >&2
    exit 1
fi
install -m 0644 libssl.so.3 ../runtime/libssl.so.3
python - "$package" <<'PY'
import hashlib
import json
import sys
from pathlib import Path

output = Path('../runtime')
source = Path(f'../openssl_{sys.argv[1]}.dsc')
record = {
    'package_version': sys.argv[1],
    'dsc_sha256': hashlib.sha256(source.read_bytes()).hexdigest(),
    'libssl_sha256': hashlib.sha256((output / 'libssl.so.3').read_bytes()).hexdigest(),
    'configure': 'no-quic',
}
(output / 'openssl-build.json').write_text(json.dumps(record, sort_keys=True) + '\n')
PY
