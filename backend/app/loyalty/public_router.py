from fastapi import APIRouter, Depends, Response
from sqlalchemy.orm import Session

from app.db import get_db
from app.loyalty.cards import read_card
from app.loyalty.schemas import PublicCardRead, PublicLoyaltyCard
from app.middleware.rate_limit import rate_limit

router = APIRouter(tags=["loyalty"])


@router.post(
    "/api/v1/public/loyalty/cards",
    response_model=PublicLoyaltyCard,
    dependencies=[Depends(rate_limit(30, window_seconds=60, key="public-loyalty-card"))],
)
def public_card(body: PublicCardRead, response: Response, db: Session = Depends(get_db)):
    response.headers["Cache-Control"] = "no-store"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Robots-Tag"] = "noindex, nofollow"
    return read_card(db, body.token)
