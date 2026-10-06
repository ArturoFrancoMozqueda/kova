FROM python:3.12-slim@sha256:dd29372629eeba2dd003fd9e9d35a5b8236c44727875a0364254b5127af88e65
RUN apt-get update && apt-get install -y --no-install-recommends clamav clamav-freshclam tesseract-ocr tesseract-ocr-spa poppler-utils && rm -rf /var/lib/apt/lists/*
RUN pip install --no-cache-dir pypdf==6.9.1 defusedxml==0.7.1
# Refuse to build a scanner with no signatures. Refresh/rebuild under release gates.
RUN freshclam --stdout
COPY parse.py /parse.py
USER 65534:65534
ENTRYPOINT ["python", "-I", "/parse.py"]
