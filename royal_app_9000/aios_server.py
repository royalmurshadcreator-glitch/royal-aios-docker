from fastapi import FastAPI
app = FastAPI(title="AIOS Master Backend (Dockerized)")

@app.get("/")
def read_root():
    return {"status": "Online", "message": "Port 9000 is running."}
