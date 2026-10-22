"""Pure ORM registry shared by metadata declarations and invocation-bound engines."""

from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass
