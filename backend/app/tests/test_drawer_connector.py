import socket
import threading
import time
from datetime import UTC, datetime, timedelta
from uuid import uuid4

import pytest

from app.hardware import connector


def _command(**patch):
    return {
        "id": str(uuid4()),
        "pin": 0,
        "ttl_ms": 4000,
        "expires_at": (datetime.now(UTC) + timedelta(seconds=5)).isoformat(),
        **patch,
    }


def test_connector_sends_only_the_five_byte_drawer_pulse_to_real_socket():
    # Real local TCP transport, no mock printer SDK or cloud provider.
    with socket.socket() as server:
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        server.settimeout(3)
        received = []

        def read():
            connection, _ = server.accept()
            with connection:
                received.append(connection.recv(100))

        reader = threading.Thread(target=read)
        reader.start()
        status = connector.process(
            {"host": "127.0.0.1", "port": server.getsockname()[1]}, _command(), time.monotonic()
        )
        reader.join(timeout=4)
        assert status == "sent"
        assert received == [b"\x1bp\x00\x32\xc8"]


def test_connector_discards_expired_or_delayed_commands_before_hardware(monkeypatch):
    writes = []
    monkeypatch.setattr(connector, "send", lambda *args: writes.append(args))
    assert (
        connector.process(
            {},
            _command(expires_at=(datetime.now(UTC) - timedelta(seconds=1)).isoformat()),
            time.monotonic(),
        )
        == "failed"
    )
    assert connector.process({}, _command(), time.monotonic() - 3) == "failed"
    assert connector.process({}, _command(pin=99), time.monotonic()) == "failed"
    assert writes == []


def test_connector_never_retries_an_uncertain_partial_hardware_write(monkeypatch):
    writes = []

    def partial(*args):
        writes.append(args)
        raise OSError("Connection lost after write")

    monkeypatch.setattr(connector, "send", partial)
    assert connector.process({}, _command(), time.monotonic()) == "failed"
    assert len(writes) == 1


@pytest.mark.parametrize(
    "url",
    [
        "http://example.com",
        "https://user:password@example.com",
        "https://example.com/path",
        "https://example.com?key=x",
    ],
)
def test_connector_rejects_insecure_or_credential_bearing_cloud_urls(url):
    with pytest.raises(ValueError):
        connector.validate_api(url)


def test_connector_refuses_redirects_instead_of_forwarding_device_key():
    with pytest.raises(ValueError):
        connector.NoRedirect().redirect_request(
            None, None, 302, None, None, "https://other.example"
        )


def test_connector_rechecks_deadline_after_tcp_connection(monkeypatch):
    class DelayedConnection:
        def __enter__(self):
            return self

        def __exit__(self, *args):
            pass

        def sendall(self, _data):
            raise AssertionError("An expired command must never be sent")

    monkeypatch.setattr(
        connector.socket, "create_connection", lambda *args, **kwargs: DelayedConnection()
    )
    with pytest.raises(TimeoutError):
        connector.send({"host": "printer", "port": 9100}, connector.pulse(0), time.monotonic() - 1)
