from fastapi import FastAPI

app = FastAPI(title="Khetwala API", version="0.1.0")


@app.get("/")
def root():
    return {"name": "Khetwala API", "status": "running"}


@app.get("/health")
def health():
    return {"status": "healthy"}