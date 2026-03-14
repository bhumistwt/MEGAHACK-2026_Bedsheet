from datetime import datetime, timedelta, timezone
from typing import Optional

from fastapi import APIRouter, Depends, Header, HTTPException, status
from jose import JWTError, jwt
from passlib.context import CryptContext
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from core.config import settings
from db.models import User
from db.session import get_db

ALGORITHM = 'HS256'
ACCESS_TOKEN_EXPIRE_DAYS = 30

pwd_context = CryptContext(schemes=['pbkdf2_sha256'], deprecated='auto')

router = APIRouter(prefix='/auth', tags=['Authentication'])
ADMIN_PHONES = {'9876543003'}


def _effective_secret_key() -> str:
    configured = (settings.secret_key or '').strip()
    if configured and configured != 'change-this-in-production':
        return configured
    if settings.is_production:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='Authentication is not configured securely',
        )
    return 'khetwala-dev-secret-local-only'


def _normalize_phone(phone: str) -> str:
    digits = ''.join(ch for ch in str(phone or '') if ch.isdigit())
    if len(digits) > 10 and digits.startswith('91'):
        digits = digits[-10:]
    return digits


def _phone_candidates(phone: str) -> list[str]:
    normalized = _normalize_phone(phone)
    if not normalized:
        return []

    candidates = [normalized]
    if len(normalized) == 10:
        candidates.append(f'91{normalized}')
        candidates.append(f'+91{normalized}')
    return list(dict.fromkeys(candidates))


def _is_admin_user(user: User) -> bool:
    return _normalize_phone(user.phone) in ADMIN_PHONES


class RegisterRequest(BaseModel):
    phone: str = Field(..., min_length=10, max_length=15)
    password: str = Field(..., min_length=6, max_length=100)
    full_name: str = Field(..., min_length=2, max_length=200)
    district: Optional[str] = None
    state: str = 'Maharashtra'


class LoginRequest(BaseModel):
    phone: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = 'bearer'
    user: dict


def create_access_token(user_id: int) -> str:
    secret_key = _effective_secret_key()
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    payload = {'sub': str(user_id), 'exp': expire, 'iat': datetime.now(timezone.utc)}
    return jwt.encode(payload, secret_key, algorithm=ALGORITHM)


def verify_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(token, _effective_secret_key(), algorithms=[ALGORITHM])
        user_id = payload.get('sub')
        if user_id is None:
            return None
        return int(user_id)
    except (JWTError, ValueError):
        return None


def user_to_dict(user: User) -> dict:
    return {
        'id': user.id,
        'phone': user.phone,
        'full_name': user.full_name,
        'district': user.district,
        'state': user.state,
        'is_admin': _is_admin_user(user),
        'created_at': user.created_at.isoformat() if user.created_at else None,
    }


def get_current_user(token: str, db: Session) -> User:
    user_id = verify_token(token)
    if user_id is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid or expired token')

    user = db.query(User).filter(User.id == user_id, User.is_active == True).first()
    if user is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='User not found')
    return user


def require_current_user(
    authorization: Optional[str] = Header(default=None),
    db: Session = Depends(get_db),
) -> User:
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Not authenticated')
    token = authorization.replace('Bearer ', '', 1)
    return get_current_user(token, db)


def ensure_user_access(current_user: User, requested_user_id: int) -> None:
    if int(current_user.id) != int(requested_user_id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Forbidden for requested user')


@router.post('/register', response_model=TokenResponse, status_code=status.HTTP_201_CREATED)
def register(body: RegisterRequest, db: Session = Depends(get_db)):
    normalized_phone = _normalize_phone(body.phone)
    if len(normalized_phone) < 10:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail='Invalid phone number')

    phone_candidates = _phone_candidates(body.phone)
    existing = db.query(User).filter(User.phone.in_(phone_candidates)).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Phone number already registered')

    user = User(
        phone=normalized_phone,
        password_hash=pwd_context.hash(body.password),
        full_name=body.full_name,
        district=body.district,
        state=body.state,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, user=user_to_dict(user))


@router.post('/login', response_model=TokenResponse)
def login(body: LoginRequest, db: Session = Depends(get_db)):
    phone_candidates = _phone_candidates(body.phone)
    if not phone_candidates:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid phone number or password')

    user = db.query(User).filter(User.phone.in_(phone_candidates), User.is_active == True).first()
    if not user or not pwd_context.verify(body.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid phone number or password')

    token = create_access_token(user.id)
    return TokenResponse(access_token=token, user=user_to_dict(user))


@router.get('/me')
def me(authorization: Optional[str] = Header(default=None), db: Session = Depends(get_db)):
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Not authenticated')
    token = authorization.replace('Bearer ', '', 1)
    user = get_current_user(token, db)
    return user_to_dict(user)
