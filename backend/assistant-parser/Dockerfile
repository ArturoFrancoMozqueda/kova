FROM python:3.12-alpine3.24@sha256:34e2f26b1dad8311d572d4074ae315778964554ca6a975518c5fd48dd2ddbda1 AS xml-build
RUN apk upgrade --no-cache \
    && apk add --no-cache build-base cmake ninja patch zlib-dev xz-dev
ADD --checksum=sha256:a2c9ae7b770da34860050c309f903221c67830c86e4a7e760692b803df95143a \
    https://download.gnome.org/sources/libxml2/2.13/libxml2-2.13.9.tar.xz /xml-source.tar.xz
COPY libxml2-patches/ /xml-patches/
COPY libxml2-tests/ /xml-tests/
COPY build_libxml2.sh /build_libxml2.sh
RUN sh /build_libxml2.sh

FROM python:3.12-alpine3.24@sha256:34e2f26b1dad8311d572d4074ae315778964554ca6a975518c5fd48dd2ddbda1 AS ocr-build
# The stable OCR package predates upstream's model-deserialization fixes.
# Build the exact maintained source instead of relabeling an affected release.
RUN apk upgrade --no-cache \
    && apk add --no-cache build-base cmake ninja leptonica-dev gtest-dev icu-dev
ADD --checksum=sha256:5248c241262c509384669753ae3f561d723975cee68c0ea1b960286b9ab05fbe \
    https://codeload.github.com/tesseract-ocr/tesseract/tar.gz/f139e578a37c5c18717195c7d603ddb357717e23 /source.tar.gz
# This fixture is required by the null-character and recoder security tests.
# It is not included in the final Spanish-only image.
ADD --checksum=sha256:7d4322bd2a7749724879683fc3912cb542f19906c83bcc1a52132556427170b2 \
    https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/eng.traineddata /tessdata/eng.traineddata
RUN mkdir /source \
    && tar -xzf /source.tar.gz --strip-components=1 -C /source \
    && cmake -S /source -B /build -G Ninja \
        -DCMAKE_BUILD_TYPE=Release -DCMAKE_INSTALL_PREFIX=/usr/local \
        -DCMAKE_INSTALL_LIBDIR=lib -DBUILD_SHARED_LIBS=OFF \
        -DBUILD_TESTS=ON -DUSE_SYSTEM_GTEST=ON -DBUILD_TRAINING_TOOLS=OFF \
        -DGRAPHICS_DISABLED=ON -DDISABLE_CURL=ON -DDISABLE_ARCHIVE=ON \
        -DOPENMP_BUILD=OFF -DENABLE_CCACHE=OFF \
    && cmake --build /build --parallel 2 --target tesseract \
        intproto_test intproto_addclass_test unicharset_load_test \
        weightmatrix_deserialize_test weightmatrix_scales_test weightmatrix_intdim_test \
        lstm_recoder_test lstm_nullchar_test recoder_test matrix_deserializesize_test \
        normproto_test adaptive_test adaptive_templates_test fullyconnected_test \
        lstm_layer_test genericvector_test plumbing_test \
    && mkdir -p /install/usr/local/share/kova-parser/upstream-tests \
    && GTEST_OUTPUT=xml:/install/usr/local/share/kova-parser/upstream-tests/ \
        ctest --test-dir /build --output-on-failure --no-tests=error \
        --output-junit /install/usr/local/share/kova-parser/upstream-tests/ctest.xml \
        -R '^(intproto_test|intproto_addclass_test|unicharset_load_test|weightmatrix_deserialize_test|weightmatrix_scales_test|weightmatrix_intdim_test|lstm_recoder_test|lstm_nullchar_test|recoder_test|matrix_deserializesize_test|normproto_test|adaptive_test|adaptive_templates_test|fullyconnected_test|lstm_layer_test|genericvector_test|plumbing_test)$' \
    && DESTDIR=/install cmake --install /build
COPY verify_upstream_tests.py /verify_upstream_tests.py
RUN python /verify_upstream_tests.py /install/usr/local/share/kova-parser/upstream-tests
# Fixed official Spanish LSTM model; user documents cannot choose or replace it.
ADD --chmod=0644 --checksum=sha256:6f2e04d02774a18f01bed44b1111f2cd7f3ba7ac9dc4373cd3f898a40ea6b464 \
    https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/4.1.0/spa.traineddata /install/usr/local/share/tessdata/spa.traineddata
COPY upstream-security.json /install/usr/local/share/kova-parser/upstream-security.json
COPY record_ocr_build.py /record_ocr_build.py
RUN python /record_ocr_build.py

FROM python:3.12-alpine3.24@sha256:34e2f26b1dad8311d572d4074ae315778964554ca6a975518c5fd48dd2ddbda1
# Stable Alpine 3.24 publishes the fixed ClamAV LTS release. Install the
# command-line scanner, not its daemon/service-management dependency tree.
RUN apk upgrade --no-cache \
    && apk add --no-cache zlib 'so:liblzma.so.5'
COPY --from=xml-build /libxml2-patched.apk /tmp/libxml2-patched.apk
# Only the locally compiled, checksum-verified build artifact is unsigned.
# Install it without network access; official repository trust stays unchanged.
RUN apk add --no-network --allow-untrusted /tmp/libxml2-patched.apk \
    && rm /tmp/libxml2-patched.apk \
    && apk add --no-cache clamav-scanner=1.4.6-r0 freshclam=1.4.6-r0 \
        leptonica=1.87.0-r0 poppler-utils=25.12.0-r1
COPY --from=ocr-build /install/usr/local/ /usr/local/
ENV TESSDATA_PREFIX=/usr/local/share/tessdata
LABEL org.kovasuite.parser.tesseract.version="5.5.3" \
      org.kovasuite.parser.tesseract.commit="f139e578a37c5c18717195c7d603ddb357717e23"
RUN pip install --no-cache-dir pypdf==6.21.2 defusedxml==0.7.1
# Refuse to build a scanner with no signatures. Refresh/rebuild under release gates.
RUN freshclam --stdout
# The runtime only extracts documents; it never installs Python packages.
RUN pip uninstall --yes pip
COPY parse.py /parse.py
USER 65534:65534
ENTRYPOINT ["python", "-I", "/parse.py"]
