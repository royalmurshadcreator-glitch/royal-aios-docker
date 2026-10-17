"""Royal AIOS Backend Wrapper Ã¢â‚¬â€ all layers + 4 middleware."""
import sys, os, importlib.util

LEADS = r'D:\01_PROJECTS\AIOS\06_TOOLS\aios_leads'
SERVER = r'aios_server.py'
SERVER_DIR = os.path.dirname(SERVER)
AIOS = r'D:\01_PROJECTS\AIOS'
for p in (LEADS, SERVER_DIR, r'D:\01_PROJECTS\Royal Murshad AIOS', AIOS, os.path.join(SERVER_DIR, 'royal_shim')):
    if p and p not in sys.path:
        sys.path.insert(0, p)

spec = importlib.util.spec_from_file_location('aios_server_module', SERVER)
mod = importlib.util.module_from_spec(spec)
sys.modules['aios_server_module'] = mod
spec.loader.exec_module(mod)

app = getattr(mod, 'app', None)
if app is None:
    print('[wrapper] FATAL: no app', file=sys.stderr); sys.exit(1)

# Ã¢â€â‚¬Ã¢â€â‚¬ Middleware (mounted BEFORE routes) Ã¢â€â‚¬Ã¢â€â‚¬
MIDDLEWARE = [
    ('aios_cors', 'cors_middleware', 'cors'),
    ('aios_sec_headers', 'security_headers_middleware', 'security_headers'),
    ('aios_correlation', 'correlation_middleware',     'correlation'),
    ('aios_rate_limit',  'rate_limit_middleware',      'rate_limit'),
        ('aios_rbac_middleware', 'rbac_middleware',        'rbac'),
    ('aios_session_identity', 'session_identity_middleware', 'session_identity'),
    ('aios_public_auth',    'basic_auth_middleware',    'basic_auth'),
]
for modname, fname, label in MIDDLEWARE:
    try:
        m = __import__(modname)
        fn = getattr(m, fname)
        app.middleware('http')(fn)
        print(f'[wrapper] OK middleware {label}')
    except Exception as e:
        print(f'[wrapper] FAIL middleware {label}: {e}', file=sys.stderr)

# Ã¢â€â‚¬Ã¢â€â‚¬ Routers Ã¢â€â‚¬Ã¢â€â‚¬
def _mount(label, fn):
    try:
        r = fn()
        if r is None: return
        app.include_router(r)
        print(f'[wrapper] OK {label}')
    except Exception as e:
        print(f'[wrapper] FAIL {label}: {e}', file=sys.stderr)

_mount('static files',    lambda: __import__('aios_static_files_api').router)
_mount('apps registry',   lambda: __import__('aios_apps_registry_api').router)
_mount('master registry', lambda: __import__('aios_master_registry_api').router)

try:
    import aios_business_master_api as biz
    app.include_router(biz.router)
    for r in biz.get_routers(): app.include_router(r)
    print(f'[wrapper] OK business layer: {len(biz.get_routers())} children')
except Exception as e:
    print(f'[wrapper] FAIL business: {e}', file=sys.stderr)

try:
    import aios_royal_master_api as royal
    for r in royal.get_routers(): app.include_router(r)
    app.include_router(royal.router)
    print(f'[wrapper] OK royal cores: {len(royal.get_routers())}')
except Exception as e:
    print(f'[wrapper] FAIL royal cores: {e}', file=sys.stderr)

from fastapi.staticfiles import StaticFiles
sd = os.path.join(SERVER_DIR, 'static')
if os.path.isdir(sd):
    try: app.mount('/static-files', StaticFiles(directory=sd), name='sf')
    except Exception: pass

import uvicorn
print('[wrapper] starting uvicorn on 127.0.0.1:9000')
uvicorn.run(app, host='127.0.0.1', port=9000, log_level='info', timeout_keep_alive=120)



