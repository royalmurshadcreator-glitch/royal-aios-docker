"""Royal Jarvis — eSIM bridge. Locates the yggdrasim/pySim toolkit and exposes it."""
from __future__ import annotations
import subprocess, sys, os
from pathlib import Path

ESIM_ROOT = Path(r"D:\01_PROJECTS\AIOS\06_TOOLS\aios_esim")
PY_SIM     = ESIM_ROOT / "aios_esim_pysim"
YGGDRASIM  = ESIM_ROOT / "aios_esim_yggdrasim"
SMDPP      = ESIM_ROOT / "aios_esim_smdpp"
PY         = Path(r"D:\01_PROJECTS\AIOS\18_ENV\.venv\Scripts\python.exe")

# Well-known CLI entry points from the toolkit
TOOLS = {
    "pySim-shell":     PY_SIM / "pySim-shell.py",
    "pySim-read":      PY_SIM / "pySim-read.py",
    "pySim-prog":      PY_SIM / "pySim-prog.py",
    "pySim-trace":     PY_SIM / "pySim-trace.py",
    "osmo-smdpp":      PY_SIM / "osmo-smdpp.py",
    "yggdrasim-main":  YGGDRASIM / "app.py",
    "smdpp-server":    SMDPP / "app.py",
}

def health():
    return {
        "ok": True,
        "esim_root": str(ESIM_ROOT),
        "esim_root_exists": ESIM_ROOT.exists(),
        "pysim_exists": PY_SIM.exists(),
        "yggdrasim_exists": YGGDRASIM.exists(),
        "smdpp_exists": SMDPP.exists(),
        "python": str(PY),
        "python_exists": PY.exists(),
    }

def tools():
    out = []
    for name, path in TOOLS.items():
        out.append({
            "name": name,
            "path": str(path),
            "exists": path.exists(),
            "size_kb": round(path.stat().st_size / 1024, 1) if path.exists() else 0,
        })
    return {"ok": True, "tools": out, "count": len(out)}

def file_inventory():
    """Count files by type across the eSIM tree."""
    result = {}
    for sub in ["aios_esim_pysim", "aios_esim_yggdrasim", "aios_esim_smdpp"]:
        root = ESIM_ROOT / sub
        if not root.exists():
            result[sub] = {"exists": False}
            continue
        files = list(root.rglob("*"))
        py = sum(1 for f in files if f.is_file() and f.suffix == ".py")
        total = sum(1 for f in files if f.is_file())
        mb = sum(f.stat().st_size for f in files if f.is_file()) / 1024 / 1024
        result[sub] = {
            "exists": True,
            "total_files": total,
            "python_files": py,
            "size_mb": round(mb, 2),
        }
    return {"ok": True, "subprojects": result}

def run_tool(name: str, args: list | None = None, timeout: int = 30):
    """Run a whitelisted CLI tool safely."""
    if name not in TOOLS:
        return {"ok": False, "error": f"unknown tool: {name}"}
    script = TOOLS[name]
    if not script.exists():
        return {"ok": False, "error": f"tool not found on disk: {script}"}
    cmd = [str(PY), str(script)] + (args or ["--help"])
    try:
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout,
                           cwd=str(script.parent))
        return {
            "ok": True,
            "tool": name,
            "cmd": " ".join(cmd),
            "returncode": r.returncode,
            "stdout": r.stdout[:2000],
            "stderr": r.stderr[:1000],
        }
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"timeout after {timeout}s"}
    except Exception as e:
        return {"ok": False, "error": str(e)}