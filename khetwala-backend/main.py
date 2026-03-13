from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from core.config import settings
from db.session import init_db
from routers.auth import router as auth_router
from routers.market import router as market_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="Khetwala API", version="0.2.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router)
app.include_router(market_router)


@app.get("/")
def root():
    return {
        "name": "Khetwala API",
        "status": "running",
        "environment": settings.environment,
    }


@app.get("/health")
def health():
    return {"status": "healthy"}