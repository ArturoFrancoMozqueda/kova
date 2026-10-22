"""Pure connection metadata parser retained from the completed migration.

The old provider credential-transfer command has been permanently retired.
"""

import re
from urllib.parse import unquote, urlsplit


def database_origin(connection):
    url = urlsplit(connection)
    if not url.hostname or not url.username or not url.password or not url.path:
        raise ValueError("Invalid database configuration")
    host, port, user = url.hostname, url.port or 5432, unquote(url.username)
    if host.endswith(".pooler.supabase.com"):
        # Hyperdrive performs pooling; chaining Supavisor's session pool causes
        # avoidable connection waits. Keep the same database role/password.
        role, separator, project = user.rpartition(".")
        if not separator or not role or not re.fullmatch(r"[a-z0-9]{20}", project):
            raise ValueError("Invalid Supabase connection metadata")
        host, port, user = f"db.{project}.supabase.co", 5432, role
    return {
        "scheme": "postgresql",
        "host": host,
        "port": port,
        "user": user,
        "password": unquote(url.password),
        "database": unquote(url.path.lstrip("/")),
    }


if __name__ == "__main__":
    raise SystemExit("Migration transfer retired; manage deployment bindings in Cloudflare")
