from sqlmodel import Session, create_engine

# SQLite simples pro MVP
DATABASE_URL = "sqlite:///./dev.db"

engine = create_engine(
    DATABASE_URL,
    echo=False,
    connect_args={"check_same_thread": False},
)

def get_session():
    with Session(engine) as session:
        yield session
