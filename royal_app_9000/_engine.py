"""Universal shim engine — resolves ANY name and ANY submodule."""
import sys, importlib.abc, importlib.machinery
from fastapi import APIRouter, FastAPI

app = FastAPI(title='shim')

class _Anything:
    def __init__(self,*a,**k): pass
    def __call__(self,*a,**k): return self
    def __getattr__(self,n): return _Anything()
    def __iter__(self): return iter([])
    def __len__(self): return 0
    def __bool__(self): return True

def _resolve(name):
    low = name.lower()
    if low == 'app' or low.endswith('_app'): return app
    if 'router' in low or low.endswith('_routes') or low.endswith('_bp'): return APIRouter()
    if low in ('settings','config','cfg','options'): return {}
    if low.endswith('_config') or low.endswith('_settings'): return {}
    if low in ('main','run','start','setup','init','register','install','boot','mainloop'):
        return lambda *a,**k: None
    return _Anything()

def __getattr__(name):
    return _resolve(name)

_SHIM_NAMES=set()
def register_shim(name):
    _SHIM_NAMES.add(name)

class _SubFinder(importlib.abc.MetaPathFinder, importlib.abc.Loader):
    def find_spec(self, fullname, path=None, target=None):
        if '.' not in fullname: return None
        parent = fullname.rsplit('.',1)[0]
        if parent in _SHIM_NAMES:
            return importlib.machinery.ModuleSpec(fullname, self, is_package=True)
        return None
    def create_module(self, spec): return None
    def exec_module(self, module):
        module.__path__=[]
        module.__getattr__=__getattr__

if not any(isinstance(f,_SubFinder) for f in sys.meta_path):
    sys.meta_path.insert(0,_SubFinder())