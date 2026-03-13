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
    if not settings.secret_key or settings.secret_key == 'change-this-in-production':
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail='Authentication is not configured securely',
        )
    expire = datetime.now(timezone.utc) + timedelta(days=ACCESS_TOKEN_EXPIRE_DAYS)
    payload = {'sub': str(user_id), 'exp': expire, 'iat': datetime.now(timezone.utc)}
    return jwt.encode(payload, settings.secret_key, algorithm=ALGORITHM)


def verify_token(token: str) -> Optional[int]:
    try:
        payload = jwt.decode(token, settings.secret_key, algorithms=[ALGORITHM])
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
    existing = db.query(User).filter(User.phone == body.phone).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail='Phone number already registered')

    user = User(
        phone=body.phone,
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
    user = db.query(User).filter(User.phone == body.phone, User.is_active == True).first()
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
