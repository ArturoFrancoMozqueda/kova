"""Existing private object operations through the invocation's R2 binding."""

from io import BytesIO

from botocore.exceptions import BotoCoreError, ClientError

from app.workers.context import environment


class R2Client:
    def _call(self, operation, bucket, key, *args):
        from pyodide.ffi import run_sync

        env = environment.get()
        binding = getattr(env, "ASSISTANT_STORAGE", None)
        # This adapter has access only to the existing private assistant bucket.
        # A configuration mismatch must never silently read another bucket.
        if binding is None or bucket != "kova-assistant":
            raise BotoCoreError()
        try:
            return run_sync(getattr(binding, operation)(key, *args))
        except Exception:
            raise BotoCoreError() from None

    def _found(self, result, operation):
        if result is None:
            raise ClientError({"ResponseMetadata": {"HTTPStatusCode": 404}}, operation)
        return result

    def head_object(self, *, Bucket, Key):
        self._found(self._call("head", Bucket, Key), "HeadObject")
        return {}

    def get_object(self, *, Bucket, Key):
        from js import Object, Uint8Array
        from pyodide.ffi import run_sync, to_js

        # Match the existing read guard without buffering an unbounded object.
        options = to_js(
            {"range": {"offset": 0, "length": 20 * 1024 * 1024 + 1}},
            dict_converter=Object.fromEntries,
        )
        result = self._found(self._call("get", Bucket, Key, options), "GetObject")
        try:
            body = Uint8Array.new(run_sync(result.arrayBuffer())).to_bytes()
        except Exception:
            raise BotoCoreError() from None
        return {"Body": BytesIO(body)}

    def put_object(self, *, Bucket, Key, Body, ContentType=None):
        from js import Object
        from pyodide.ffi import to_js

        from app.workers.crypto import js_bytes

        options = to_js(
            {"httpMetadata": {"contentType": ContentType or "application/octet-stream"}},
            dict_converter=Object.fromEntries,
        )
        self._call("put", Bucket, Key, js_bytes(Body), options)
        return {}

    def delete_object(self, *, Bucket, Key):
        self._call("delete", Bucket, Key)
        return {}
