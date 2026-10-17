"""
aios_llm.py — Sovereign LLM inference server.
Drop-in replacement for Ollama. Same API, same models, pure Python.

Endpoints (Ollama-compatible):
  GET  /                    -> status
  GET  /api/tags            -> list models
  POST /api/chat            -> chat completion
  POST /api/generate        -> text completion
  POST /api/embeddings      -> embeddings
  GET  /api/version         -> version info

Port: 11435 (test) — set to 11434 to replace Ollama in production.
"""
from __future__ import annotations
import json
import time
import threading
from pathlib import Path
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from llama_cpp import Llama

ROOT = Path(r"D:\01_PROJECTS\AIOS")
MODEL_DIR = ROOT / "06_TOOLS" / "aios_quran" / "model" / "gguf"
PORT = 11434

# ──────────────────────────── Model registry ────────────────────────────
MODELS = {
    "qwen2.5:3b":        {"file": "qwen2.5-3b-instruct.gguf", "type": "llm",   "n_ctx": 4096},
    "qwen2.5-coder:7b":  {"file": "qwen2.5-coder-7b.gguf",    "type": "llm",   "n_ctx": 4096},
    "nomic-embed-text":  {"file": "nomic-embed-text.gguf",    "type": "embed", "n_ctx": 2048},
}

# ──────────────────────────── Model cache ────────────────────────────
_LOCK = threading.Lock()
_CACHE: Dict[str, Llama] = {}

def _get_model(name: str) -> Llama:
    if name not in MODELS:
        raise HTTPException(404, f"model '{name}' not found")
    meta = MODELS[name]
    path = MODEL_DIR / meta["file"]
    if not path.exists():
        raise HTTPException(500, f"model file missing: {path}")
    with _LOCK:
        if name not in _CACHE:
            print(f"[aios_llm] loading {name} from {path.name} ...", flush=True)
            t0 = time.time()
            _CACHE[name] = Llama(
                model_path=str(path),
                n_ctx=meta["n_ctx"],
                n_threads=4,
                n_gpu_layers=0,
                embedding=(meta["type"] == "embed"),
                verbose=False,
            )
            print(f"[aios_llm] loaded {name} in {time.time()-t0:.1f}s", flush=True)
        return _CACHE[name]

# ──────────────────────────── FastAPI app ────────────────────────────
app = FastAPI(title="aios_llm", version="1.0.0")


class ChatMessage(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    model: str = "qwen2.5:3b"
    messages: List[ChatMessage]
    stream: bool = False
    options: Optional[Dict[str, Any]] = None


class GenerateRequest(BaseModel):
    model: str = "qwen2.5:3b"
    prompt: str
    stream: bool = False
    options: Optional[Dict[str, Any]] = None


class EmbedRequest(BaseModel):
    model: str = "nomic-embed-text"
    prompt: str


@app.get("/")
def root():
    return {"status": "ok", "service": "aios_llm", "port": PORT,
            "models_loaded": list(_CACHE.keys()),
            "models_available": list(MODELS.keys())}


@app.get("/api/version")
def version():
    return {"version": "1.0.0", "engine": "llama_cpp", "author": "AIOS"}


@app.get("/api/tags")
def tags():
    models = []
    for name, meta in MODELS.items():
        path = MODEL_DIR / meta["file"]
        size = path.stat().st_size if path.exists() else 0
        models.append({
            "name": name,
            "model": name,
            "size": size,
            "digest": f"aios_{name}",
            "details": {
                "family": "qwen2" if "qwen" in name else "nomic",
                "parameter_size": "3B" if "3b" in name else ("7B" if "7b" in name else "137M"),
            },
        })
    return {"models": models}


@app.post("/api/chat")
def chat(req: ChatRequest):
    llm = _get_model(req.model)
    opts = req.options or {}
    max_tokens = int(opts.get("num_predict", 256))
    temperature = float(opts.get("temperature", 0.7))

    # Convert messages into a simple chat prompt
    prompt_parts = []
    for m in req.messages:
        if m.role == "system":
            prompt_parts.append(f"System: {m.content}")
        elif m.role == "user":
            prompt_parts.append(f"User: {m.content}")
        elif m.role == "assistant":
            prompt_parts.append(f"Assistant: {m.content}")
    prompt_parts.append("Assistant:")
    prompt = "\n".join(prompt_parts)

    t0 = time.time()
    out = llm(prompt, max_tokens=max_tokens, temperature=temperature, echo=False)
    elapsed = time.time() - t0
    reply = out["choices"][0]["text"].strip()

    return {
        "model": req.model,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "message": {"role": "assistant", "content": reply},
        "done": True,
        "total_duration": int(elapsed * 1e9),
        "eval_count": out.get("usage", {}).get("completion_tokens", 0),
    }


@app.post("/api/generate")
def generate(req: GenerateRequest):
    llm = _get_model(req.model)
    opts = req.options or {}
    max_tokens = int(opts.get("num_predict", 256))
    temperature = float(opts.get("temperature", 0.7))

    t0 = time.time()
    out = llm(req.prompt, max_tokens=max_tokens, temperature=temperature, echo=False)
    elapsed = time.time() - t0
    text = out["choices"][0]["text"].strip()

    return {
        "model": req.model,
        "created_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "response": text,
        "done": True,
        "total_duration": int(elapsed * 1e9),
    }


@app.post("/api/embeddings")
def embeddings(req: EmbedRequest):
    llm = _get_model(req.model)
    out = llm.create_embedding(req.prompt)
    vec = out["data"][0]["embedding"]
    return {"embedding": vec}


if __name__ == "__main__":
    import uvicorn
    print(f"[aios_llm] starting on port {PORT}")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="info")
