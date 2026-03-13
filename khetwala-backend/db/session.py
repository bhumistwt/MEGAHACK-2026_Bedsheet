from typing import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

from core.config import settings


class Base(DeclarativeBase):
    pass


is_sqlite = settings.database_url.startswith('sqlite')
engine_kwargs = {'echo': False}
if is_sqlite:
    engine_kwargs['connect_args'] = {'check_same_thread': False}

engine = create_engine(settings.database_url, **engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


def get_db() -> Generator[Session, None, None]:
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db() -> None:
    from db.models import User
    Base.metadata.create_all(bind=engine)
