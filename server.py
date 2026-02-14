# server.py
import time
import secrets
import math
from typing import Optional, Dict, Any, List, Tuple

from fastapi import FastAPI, Request, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import jwt  # PyJWT

APP_VERSION = "0.1-hackathon"

# -------------------------
# Config
# -------------------------
SESSION_TTL_SEC = 40              # session validity
CHALLENGE_TTL_SEC = 25            # layer 2 validity window
TOKEN_TTL_SEC = 120               # PoL token validity
RATE_LIMIT_MAX = 3                # tries
RATE_LIMIT_WINDOW_SEC = 60        # per session+ip

JWT_SECRET = "CHANGE_ME_SUPER_SECRET"
JWT_ALG = "HS256"

# -------------------------
# In-memory stores (hackathon)
# -------------------------
SESSIONS: Dict[str, Dict[str, Any]] = {}
TOKENS_USED: set = set()
RATE_LOG: Dict[str, List[float]] = {}  # key: f"{session_id}:{ip}" -> timestamps

# -------------------------
# Utilities
# -------------------------
def now() -> float:
    return time.time()

def clamp(x: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, x))

def get_ip(req: Request) -> str:
    # If behind proxy, you'd read X-Forwarded-For safely.
    return req.client.host if req.client else "unknown"

def rate_limit_check(session_id: str, ip: str) -> None:
    key = f"{session_id}:{ip}"
    ts = RATE_LOG.get(key, [])
    cutoff = now() - RATE_LIMIT_WINDOW_SEC
    ts = [t for t in ts if t >= cutoff]
    if len(ts) >= RATE_LIMIT_MAX:
        raise HTTPException(status_code=429, detail="rate_limited")
    ts.append(now())
    RATE_LOG[key] = ts

def require_session(session_id: str) -> Dict[str, Any]:
    s = SESSIONS.get(session_id)
    if not s:
        raise HTTPException(status_code=404, detail="invalid_session")
    if s["expires_at"] < now():
        raise HTTPException(status_code=410, detail="session_expired")
    return s

def sign_token(payload: dict) -> str:
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def verify_jwt(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="token_expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="invalid_token")

# -------------------------
# Risk scoring (Layer 1)
# -------------------------
def layer1_risk_score(time_ms: int, final_val: int, target_val: int, moves: int) -> Tuple[str, float]:
    """
    Returns (risk_label, score_0_1 where 1 is high risk).
    Heuristics only (hackathon): too fast + perfect + low movement -> suspicious.
    """
    dt = time_ms / 1000.0
    perfect = (final_val == target_val)
    dist = abs(final_val - target_val)

    # base risk
    risk = 0.0

    # very fast completion
    if dt < 1.0:
        risk += 0.45
    elif dt < 2.0:
        risk += 0.25
    elif dt > 12.0:
        # overly slow can also be suspicious (script waiting), but mild
        risk += 0.05

    # "too perfect" + low movement is suspicious
    if perfect and moves <= 2:
        risk += 0.35
    elif dist == 0:
        risk += 0.15

    # very few mouse moves
    if moves == 0:
        risk += 0.25
    elif moves <= 2:
        risk += 0.10

    risk = clamp(risk, 0.0, 1.0)
    if risk < 0.33:
        return ("low", risk)
    elif risk < 0.66:
        return ("medium", risk)
    else:
        return ("high", risk)

# -------------------------
# API Models
# -------------------------
class StartResp(BaseModel):
    session_id: str
    session_expires_in: int
    layer1_target: int
    layer2_mode: str
    layer2_params: dict
    phrase_words: Optional[List[str]] = None
    strictness: str

class Layer1Submit(BaseModel):
    time_ms: int
    final_val: int
    target_val: int
    moves: int

class Layer2BeepSubmit(BaseModel):
    nonce: str
    heard_at_ms: int     # timestamp client says beep occurred (relative)
    click_at_ms: int     # timestamp client clicked (relative)

class Layer2NeedleSubmit(BaseModel):
    nonce: str
    # compressed trace: list of (t_ms, cursor_norm, needle_norm)
    trace: List[Tuple[int, float, float]]

class Layer35SpeechSubmit(BaseModel):
    nonce: str
    transcript: str

class TokenResp(BaseModel):
    token: str
    expires_in: int

# -------------------------
# FastAPI App
# -------------------------
app = FastAPI(title="Proof-of-Life", version=APP_VERSION)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # tighten in real
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")

@app.get("/", response_class=HTMLResponse)
def root():
    # Serve the SPA
    with open("static/index.html", "r", encoding="utf-8") as f:
        return f.read()

@app.post("/api/start", response_model=StartResp)
def start(req: Request):
    """
    Creates session + chooses Layer2 mode params.
    """
    session_id = secrets.token_urlsafe(16)
    expires_at = now() + SESSION_TTL_SEC

    # Layer 1 target volume
    layer1_target = secrets.choice([13, 27, 42, 58, 71, 86])

    # Choose layer2 mode (hackathon: choose beep-click by default)
    layer2_mode = "beep_click"  # or "follow_needle"

    # For beep-click: beep at random time 2000-6000ms
    beep_at_ms = secrets.randbelow(4001) + 2000  # [2000,6000]
    # tolerance depends on strictness decided later by Layer1 risk
    layer2_params = {"beep_at_ms": beep_at_ms}

    # 2-word phrase (Layer 3.5)
    phrase_pool = [
        ("silver", "cactus"),
        ("rapid", "ocean"),
        ("mint", "ladder"),
        ("copper", "velvet"),
        ("neon", "pencil"),
        ("quiet", "rocket"),
    ]
    phrase_words = list(secrets.choice(phrase_pool))

    # Nonce for each stage (layer2, layer3.5)
    nonce = secrets.token_urlsafe(12)

    SESSIONS[session_id] = {
        "created_at": now(),
        "expires_at": expires_at,
        "ip_created": get_ip(req),
        "layer1": {"target": layer1_target, "submitted": False, "risk": None},
        "layer2": {
            "mode": layer2_mode,
            "params": layer2_params,
            "nonce": nonce,
            "expires_at": 0,
            "used": False,
            "passed": False,
        },
        "layer35": {
            "words": phrase_words,
            "nonce": secrets.token_urlsafe(12),
            "expires_at": now() + 70,
            "used": False,
            "passed": False,
            "enabled": True,
        },
        "strictness": "unknown",
    }

    # initial strictness unknown until Layer1; frontend can start Layer1 immediately
    return StartResp(
        session_id=session_id,
        session_expires_in=int(expires_at - now()),
        layer1_target=layer1_target,
        layer2_mode=layer2_mode,
        layer2_params=layer2_params,
        phrase_words=phrase_words,
        strictness="adaptive",
    )

@app.post("/api/{session_id}/layer1")
def submit_layer1(session_id: str, payload: Layer1Submit, req: Request):
    s = require_session(session_id)
    rate_limit_check(session_id, get_ip(req))

    if s["layer1"]["submitted"]:
        raise HTTPException(status_code=409, detail="layer1_already_submitted")

    # basic integrity check: target must match session target
    if payload.target_val != s["layer1"]["target"]:
        raise HTTPException(status_code=400, detail="target_mismatch")

    risk_label, risk_score = layer1_risk_score(
        time_ms=payload.time_ms,
        final_val=payload.final_val,
        target_val=payload.target_val,
        moves=payload.moves,
    )

    s["layer1"]["submitted"] = True
    s["layer1"]["risk"] = {"label": risk_label, "score": risk_score}

    # Decide strictness for Layer2:
    # - low: wide tolerance
    # - medium: moderate tolerance
    # - high: narrow tolerance + require Layer3.5
    if risk_label == "low":
        s["strictness"] = "lenient"
        s["layer2"]["params"]["tolerance_ms"] = 650
        s["layer35"]["enabled"] = False
    elif risk_label == "medium":
        s["strictness"] = "standard"
        s["layer2"]["params"]["tolerance_ms"] = 450
        s["layer35"]["enabled"] = True
    else:
        s["strictness"] = "strict"
        s["layer2"]["params"]["tolerance_ms"] = 300
        s["layer35"]["enabled"] = True

    s["layer2"]["expires_at"] = now() + CHALLENGE_TTL_SEC
    s["layer2"]["used"] = False
    s["layer2"]["passed"] = False

    return {
        "risk": s["layer1"]["risk"],
        "strictness": s["strictness"],
        "layer2": {
            "mode": s["layer2"]["mode"],
            "params": s["layer2"]["params"],
            "nonce": s["layer2"]["nonce"],
            "expires_in": int(s["layer2"]["expires_at"] - now()),
        },
        "layer35": {
            "enabled": s["layer35"]["enabled"],
            "words": s["layer35"]["words"] if s["layer35"]["enabled"] else None,
            "nonce": s["layer35"]["nonce"] if s["layer35"]["enabled"] else None,
            "expires_in": int(s["layer35"]["expires_at"] - now()) if s["layer35"]["enabled"] else None,
        },
    }

@app.post("/api/{session_id}/layer2/beep")
def submit_layer2_beep(session_id: str, payload: Layer2BeepSubmit, req: Request):
    s = require_session(session_id)
    rate_limit_check(session_id, get_ip(req))

    l2 = s["layer2"]
    if l2["used"]:
        raise HTTPException(status_code=409, detail="layer2_used")
    if l2["expires_at"] < now():
        raise HTTPException(status_code=410, detail="layer2_expired")
    if payload.nonce != l2["nonce"]:
        raise HTTPException(status_code=400, detail="nonce_mismatch")
    if l2["mode"] != "beep_click":
        raise HTTPException(status_code=400, detail="wrong_mode")

    l2["used"] = True  # one-time
    beep_at = l2["params"]["beep_at_ms"]
    tol = l2["params"].get("tolerance_ms", 450)

    # Accept if click time is close to beep time (client-relative timing)
    delta = abs(payload.click_at_ms - beep_at)

    # Very basic bot-ish checks: clicking before beep by a lot
    if payload.click_at_ms < (beep_at - tol):
        l2["passed"] = False
        return {"passed": False, "reason": "clicked_too_early", "delta_ms": delta}

    if delta <= tol:
        l2["passed"] = True
        return {"passed": True, "delta_ms": delta, "tolerance_ms": tol}
    else:
        l2["passed"] = False
        return {"passed": False, "reason": "timing_off", "delta_ms": delta, "tolerance_ms": tol}

@app.post("/api/{session_id}/layer2/needle")
def submit_layer2_needle(session_id: str, payload: Layer2NeedleSubmit, req: Request):
    """
    Optional stronger mode ensure cursor tracks needle.
    Here we score mean absolute error over time.
    """
    s = require_session(session_id)
    rate_limit_check(session_id, get_ip(req))

    l2 = s["layer2"]
    if l2["used"]:
        raise HTTPException(status_code=409, detail="layer2_used")
    if l2["expires_at"] < now():
        raise HTTPException(status_code=410, detail="layer2_expired")
    if payload.nonce != l2["nonce"]:
        raise HTTPException(status_code=400, detail="nonce_mismatch")
    if l2["mode"] != "follow_needle":
        raise HTTPException(status_code=400, detail="wrong_mode")

    l2["used"] = True

    trace = payload.trace
    if len(trace) < 15:
        l2["passed"] = False
        return {"passed": False, "reason": "insufficient_trace"}

    # Compute average error
    errors = []
    for t_ms, cur, ndl in trace:
        errors.append(abs(cur - ndl))
    mae = sum(errors) / len(errors)

    # Threshold depends on strictness
    strictness = s.get("strictness", "standard")
    if strictness == "lenient":
        thresh = 0.18
    elif strictness == "strict":
        thresh = 0.10
    else:
        thresh = 0.13

    passed = mae <= thresh
    l2["passed"] = passed
    return {"passed": passed, "mae": mae, "threshold": thresh}

@app.post("/api/{session_id}/layer35/speech")
def submit_layer35_speech(session_id: str, payload: Layer35SpeechSubmit, req: Request):
    s = require_session(session_id)
    rate_limit_check(session_id, get_ip(req))

    l35 = s["layer35"]
    if not l35["enabled"]:
        return {"passed": True, "skipped": True}
    if l35["used"]:
        raise HTTPException(status_code=409, detail="layer35_used")
    if l35["expires_at"] < now():
        raise HTTPException(status_code=410, detail="layer35_expired")
    if payload.nonce != l35["nonce"]:
        raise HTTPException(status_code=400, detail="nonce_mismatch")

    l35["used"] = True

    transcript = (payload.transcript or "").lower()
    w1, w2 = [w.lower() for w in l35["words"]]
    passed = (w1 in transcript) and (w2 in transcript)

    l35["passed"] = passed
    return {"passed": passed, "expected": l35["words"], "transcript": payload.transcript}

@app.post("/api/{session_id}/finalize", response_model=TokenResp)
def finalize(session_id: str, req: Request):
    """
    Layer 3 enforcement and token issuance.
    """
    s = require_session(session_id)
    rate_limit_check(session_id, get_ip(req))

    # Must have completed Layer1 (risk computed)
    if not s["layer1"]["submitted"]:
        raise HTTPException(status_code=400, detail="layer1_required")

    # Must have passed Layer2
    if not s["layer2"]["passed"]:
        raise HTTPException(status_code=401, detail="layer2_failed")

    # If enabled, must pass Layer3.5
    if s["layer35"]["enabled"] and (not s["layer35"]["passed"]):
        raise HTTPException(status_code=401, detail="layer35_failed")

    # One-time token issuance per session
    if s.get("token_issued"):
        raise HTTPException(status_code=409, detail="token_already_issued")

    # Issue PoL token
    jti = secrets.token_urlsafe(12)
    exp = int(now() + TOKEN_TTL_SEC)

    token = sign_token({
        "typ": "proof_of_life",
        "sid": session_id,
        "jti": jti,
        "exp": exp,
        "iat": int(now()),
        "risk": s["layer1"]["risk"],
        "strictness": s["strictness"],
    })

    s["token_issued"] = True
    s["token_jti"] = jti

    return TokenResp(token=token, expires_in=TOKEN_TTL_SEC)

@app.post("/api/consume")
def consume_token(token: str):
    """
    Demo endpoint showing replay resistance:
    - validates signature + exp
    - enforces one-time use via jti
    """
    payload = verify_jwt(token)
    if payload.get("typ") != "proof_of_life":
        raise HTTPException(status_code=400, detail="wrong_token_type")

    jti = payload.get("jti")
    if not jti:
        raise HTTPException(status_code=400, detail="missing_jti")

    if jti in TOKENS_USED:
        raise HTTPException(status_code=409, detail="token_replayed")

    TOKENS_USED.add(jti)
    return {"ok": True, "message": "token_consumed", "sid": payload.get("sid")}
