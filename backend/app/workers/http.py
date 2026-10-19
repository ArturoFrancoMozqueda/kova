"""urllib response/error contracts over the WASM httpx Fetch transport."""

from email.message import Message
from io import BytesIO
from urllib.error import HTTPError, URLError
from urllib.response import addinfourl

import httpx

MAX_RESPONSE_BYTES = 4 * 1024 * 1024


def urlopen(request, *, timeout):
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True, trust_env=False) as client:
            with client.stream(
                request.get_method(), request.full_url,
                headers=dict(request.header_items()), content=request.data,
            ) as response:
                chunks = []
                size = 0
                for chunk in response.iter_bytes():
                    size += len(chunk)
                    if size > MAX_RESPONSE_BYTES:
                        raise URLError("Provider response exceeded the resource limit")
                    chunks.append(chunk)
                body = BytesIO(b"".join(chunks))
                headers = Message()
                for key, value in response.headers.multi_items():
                    headers[key] = value
                status = response.status_code
                url, reason = str(response.url), response.reason_phrase
    except httpx.RequestError:
        # Provider exceptions can include URLs or request details. Preserve
        # the existing retry/error category without retaining those values.
        raise URLError("Provider request failed") from None
    if status >= 400:
        raise HTTPError(url, status, reason, headers, body)
    return addinfourl(body, headers, url, status)
