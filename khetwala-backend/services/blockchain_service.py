"""
Blockchain Trust Layer — Service
═══════════════════════════════════════════════════════════════════════════════

Handles all blockchain interactions for Khetwala-मित्र:
  • Custodial wallet signing (farmers never touch crypto)
  • RecommendationProof  → anchor AI output hashes on Polygon
  • TradeAgreement       → immutable farmer-buyer contracts
  • Settlement / Escrow  → lock / release / penalise funds

Design principles:
  ─ Off-chain: AI models, sensor data, user info
  ─ On-chain:  Only hashes, agreement IDs, escrow state
  ─ No token creation, no crypto trading
  ─ Gas-optimised: Polygon PoS (< $0.01 per tx)
"""

import hashlib
import json
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from core.logging import get_logger

logger = get_logger("khetwala.blockchain")

# ═══════════════════════════════════════════════════════════════════════════════
# Configuration
# ═══════════════════════════════════════════════════════════════════════════════

# Polygon RPC (default: Mumbai testnet for dev, mainnet in production)
POLYGON_RPC_URL = os.getenv(
    "POLYGON_RPC_URL",
    "https://rpc-mumbai.maticvigil.com"
)
CUSTODIAL_PRIVATE_KEY = os.getenv("CUSTODIAL_PRIVATE_KEY", "")
PROOF_CONTRACT_ADDRESS = os.getenv("PROOF_CONTRACT_ADDRESS", "")
TRADE_CONTRACT_ADDRESS = os.getenv("TRADE_CONTRACT_ADDRESS", "")
SETTLEMENT_CONTRACT_ADDRESS = os.getenv("SETTLEMENT_CONTRACT_ADDRESS", "")

# Polygon block explorer base URL
POLYGONSCAN_BASE = os.getenv(
    "POLYGONSCAN_BASE",
    "https://mumbai.polygonscan.com"
)


# ═══════════════════════════════════════════════════════════════════════════════
# Hash Utilities  (off-chain → keccak256-style digest)
# ═══════════════════════════════════════════════════════════════════════════════


def compute_data_hash(data: Dict[str, Any]) -> str:
    """
    Deterministic SHA-256 hash of a JSON-serialisable dict.
    Returns 0x-prefixed hex string (66 chars) matching Solidity bytes32.
    """
    canonical = json.dumps(data, sort_keys=True, separators=(",", ":"))
    digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    return f"0x{digest}"


# ═══════════════════════════════════════════════════════════════════════════════
# Web3 Interaction Layer (graceful degradation when web3 unavailable)
# ═══════════════════════════════════════════════════════════════════════════════

_web3 = None
_account = None


def _get_web3():
    """Lazy-load web3 connection."""
    global _web3, _account
    if _web3 is not None:
        return _web3, _account

    try:
        from web3 import Web3
        from web3.middleware import ExtraDataToPOAMiddleware

        _web3 = Web3(Web3.HTTPProvider(POLYGON_RPC_URL))
        # Polygon PoS uses PoA consensus
        _web3.middleware_onion.inject(ExtraDataToPOAMiddleware, layer=0)

        if CUSTODIAL_PRIVATE_KEY:
            _account = _web3.eth.account.from_key(CUSTODIAL_PRIVATE_KEY)
            logger.info(
                "Blockchain service connected",
                rpc=POLYGON_RPC_URL,
                wallet=_account.address,
            )
        else:
            logger.warning("No CUSTODIAL_PRIVATE_KEY set — blockchain writes disabled")

        return _web3, _account
    except ImportError:
        logger.warning("web3 package not installed — running in simulation mode")
        return None, None
    except Exception as exc:
        logger.error(f"Web3 connection failed: {exc}")
        return None, None


def _is_blockchain_live() -> bool:
    """Check if blockchain connectivity is available."""
    w3, acct = _get_web3()
    return w3 is not None and acct is not None and w3.is_connected()


# ═══════════════════════════════════════════════════════════════════════════════
# Contract ABIs (minimal — only the functions we call)
# ═══════════════════════════════════════════════════════════════════════════════

PROOF_ABI = json.loads("""[
  {
    "inputs": [
      {"name": "crop", "type": "string"},
      {"name": "region", "type": "string"},
      {"name": "inputHash", "type": "bytes32"},
      {"name": "outputHash", "type": "bytes32"},
      {"name": "modelVersion", "type": "string"}
    ],
    "name": "createProof",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "proofId", "type": "uint256"}],
    "name": "getProof",
    "outputs": [
      {"name": "crop", "type": "string"},
      {"name": "region", "type": "string"},
      {"name": "inputHash", "type": "bytes32"},
      {"name": "outputHash", "type": "bytes32"},
      {"name": "modelVersion", "type": "string"},
      {"name": "timestamp", "type": "uint256"},
      {"name": "creator", "type": "address"}
    ],
    "stateMutability": "view",
    "type": "function"
  }
]""")

TRADE_ABI = json.loads("""[
  {
    "inputs": [
      {"name": "sellerId", "type": "uint256"},
      {"name": "buyerId", "type": "uint256"},
      {"name": "quantityKg", "type": "uint256"},
      {"name": "pricePerKg", "type": "uint256"},
      {"name": "qualityGrade", "type": "string"},
      {"name": "deliveryDeadline", "type": "uint256"},
      {"name": "penaltyRate", "type": "uint256"}
    ],
    "name": "createTrade",
    "outputs": [{"name": "", "type": "uint256"}],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "tradeId", "type": "uint256"}],
    "name": "confirmDelivery",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "tradeId", "type": "uint256"}],
    "name": "cancelTrade",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "tradeId", "type": "uint256"}],
    "name": "getTrade",
    "outputs": [
      {"name": "sellerId", "type": "uint256"},
      {"name": "buyerId", "type": "uint256"},
      {"name": "quantityKg", "type": "uint256"},
      {"name": "pricePerKg", "type": "uint256"},
      {"name": "qualityGrade", "type": "string"},
      {"name": "deliveryDeadline", "type": "uint256"},
      {"name": "penaltyRate", "type": "uint256"},
      {"name": "status", "type": "uint8"},
      {"name": "timestamp", "type": "uint256"}
    ],
    "stateMutability": "view",
    "type": "function"
  }
]""")

SETTLEMENT_ABI = json.loads("""[
  {
    "inputs": [{"name": "tradeId", "type": "uint256"}],
    "name": "lockFunds",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [{"name": "tradeId", "type": "uint256"}],
    "name": "releaseFunds",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "tradeId", "type": "uint256"}],
    "name": "applyPenalty",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "tradeId", "type": "uint256"}],
    "name": "refund",
    "outputs": [],
    "stateMutability": "nonpayable",
    "type": "function"
  },
  {
    "inputs": [{"name": "tradeId", "type": "uint256"}],
    "name": "getSettlement",
    "outputs": [
      {"name": "amount", "type": "uint256"},
      {"name": "status", "type": "uint8"},
      {"name": "timestamp", "type": "uint256"}
    ],
    "stateMutability": "view",
    "type": "function"
  }
]""")


# ═══════════════════════════════════════════════════════════════════════════════
# Service Functions — Recommendation Proofs
# ═══════════════════════════════════════════════════════════════════════════════


def anchor_recommendation_proof(
    user_id: int,
    crop: str,
    region: str,
    input_data: Dict[str, Any],
    output_data: Dict[str, Any],
    model_version: str = "1.0.0",
    db=None,
) -> Dict[str, Any]:
    """
    Anchor an AI recommendation proof on Polygon.

    Steps:
      1. Compute SHA-256 hashes of input & output data
      2. Submit createProof() tx to RecommendationProof contract
      3. Store ProofRecord in DB with tx_hash

    Returns proof metadata dict.
    """
    from db.models import ProofRecord

    input_hash = compute_data_hash(input_data)
    output_hash = compute_data_hash(output_data)

    # Create DB record first (pending)
    proof = ProofRecord(
        user_id=user_id,
        crop=crop,
        region=region,
        input_hash=input_hash,
        output_hash=output_hash,
        model_version=model_version,
        status="pending",
    )

    if db:
        db.add(proof)
        db.flush()

    tx_hash = None
    block_number = None

    # Try on-chain anchoring
    if _is_blockchain_live() and PROOF_CONTRACT_ADDRESS:
        try:
            w3, acct = _get_web3()
            contract = w3.eth.contract(
                address=w3.to_checksum_address(PROOF_CONTRACT_ADDRESS),
                abi=PROOF_ABI,
            )
            tx = contract.functions.createProof(
                crop,
                region,
                bytes.fromhex(input_hash[2:]),
                bytes.fromhex(output_hash[2:]),
                model_version,
            ).build_transaction({
                "from": acct.address,
                "nonce": w3.eth.get_transaction_count(acct.address),
                "gas": 300_000,
                "gasPrice": w3.eth.gas_price,
            })
            signed = acct.sign_transaction(tx)
            tx_hash_bytes = w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash_bytes, timeout=60)

            tx_hash = receipt.transactionHash.hex()
            if not tx_hash.startswith("0x"):
                tx_hash = f"0x{tx_hash}"
            block_number = receipt.blockNumber

            proof.tx_hash = tx_hash
            proof.block_number = block_number
            proof.status = "confirmed"
            logger.info(f"Proof anchored on-chain: tx={tx_hash}")

        except Exception as exc:
            logger.error(f"On-chain proof anchoring failed: {exc}")
            proof.status = "failed"
    else:
        # Simulation mode — generate deterministic mock tx hash
        sim_hash = compute_data_hash({"proof": input_hash, "ts": str(datetime.now(timezone.utc))})
        proof.tx_hash = sim_hash
        proof.status = "simulated"
        tx_hash = sim_hash
        logger.info(f"Proof anchored (simulation): {sim_hash}")

    if db:
        db.commit()
        db.refresh(proof)

    return {
        "proof_id": proof.id if proof.id else 0,
        "input_hash": input_hash,
        "output_hash": output_hash,
        "tx_hash": tx_hash,
        "block_number": block_number,
        "status": proof.status,
        "explorer_url": f"{POLYGONSCAN_BASE}/tx/{tx_hash}" if tx_hash else None,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Service Functions — Trade Agreements
# ═══════════════════════════════════════════════════════════════════════════════


def create_trade(
    seller_id: int,
    buyer_id: int,
    crop: str,
    quantity_kg: float,
    price_per_kg: float,
    quality_grade: str = "A",
    delivery_deadline: Optional[datetime] = None,
    penalty_rate: float = 5.0,
    db=None,
) -> Dict[str, Any]:
    """
    Create a trade agreement on-chain and persist in DB.
    Farmer sees: "Deal Confirmed ✅"
    """
    from db.models import TradeRecord

    total_amount = round(quantity_kg * price_per_kg, 2)

    trade = TradeRecord(
        seller_id=seller_id,
        buyer_id=buyer_id,
        crop=crop,
        quantity_kg=quantity_kg,
        price_per_kg=price_per_kg,
        total_amount=total_amount,
        quality_grade=quality_grade,
        delivery_deadline=delivery_deadline,
        penalty_rate=penalty_rate,
        status="created",
    )

    if db:
        db.add(trade)
        db.flush()

    tx_hash = None
    block_number = None
    contract_trade_id = None

    if _is_blockchain_live() and TRADE_CONTRACT_ADDRESS:
        try:
            w3, acct = _get_web3()
            contract = w3.eth.contract(
                address=w3.to_checksum_address(TRADE_CONTRACT_ADDRESS),
                abi=TRADE_ABI,
            )

            deadline_ts = int(delivery_deadline.timestamp()) if delivery_deadline else 0
            penalty_bps = int(penalty_rate * 100)  # basis points

            tx = contract.functions.createTrade(
                seller_id,
                buyer_id,
                int(quantity_kg * 1000),   # grams for precision
                int(price_per_kg * 100),   # paise for precision
                quality_grade,
                deadline_ts,
                penalty_bps,
            ).build_transaction({
                "from": acct.address,
                "nonce": w3.eth.get_transaction_count(acct.address),
                "gas": 400_000,
                "gasPrice": w3.eth.gas_price,
            })
            signed = acct.sign_transaction(tx)
            tx_hash_bytes = w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash_bytes, timeout=60)

            tx_hash = receipt.transactionHash.hex()
            if not tx_hash.startswith("0x"):
                tx_hash = f"0x{tx_hash}"
            block_number = receipt.blockNumber

            # Parse trade ID from logs (first topic after event sig)
            if receipt.logs:
                contract_trade_id = int(receipt.logs[0]["topics"][1].hex(), 16)

            trade.tx_hash = tx_hash
            trade.block_number = block_number
            trade.contract_trade_id = contract_trade_id
            trade.status = "confirmed"

            logger.info(f"Trade created on-chain: tx={tx_hash}, tradeId={contract_trade_id}")

        except Exception as exc:
            logger.error(f"On-chain trade creation failed: {exc}")
            trade.status = "confirmed"  # Still valid off-chain
    else:
        sim_hash = compute_data_hash({
            "trade": f"{seller_id}-{buyer_id}",
            "ts": str(datetime.now(timezone.utc)),
        })
        trade.tx_hash = sim_hash
        trade.status = "confirmed"
        tx_hash = sim_hash

    if db:
        db.commit()
        db.refresh(trade)

    return {
        "trade_id": trade.id if trade.id else 0,
        "seller_id": seller_id,
        "buyer_id": buyer_id,
        "crop": crop,
        "quantity_kg": quantity_kg,
        "price_per_kg": price_per_kg,
        "total_amount": total_amount,
        "quality_grade": quality_grade,
        "status": trade.status,
        "tx_hash": tx_hash,
        "explorer_url": f"{POLYGONSCAN_BASE}/tx/{tx_hash}" if tx_hash else None,
        "farmer_status": "Deal Confirmed ✅",
    }


def confirm_delivery(trade_id: int, db=None) -> Dict[str, Any]:
    """Mark trade as delivered. Farmer sees: 'Delivery Confirmed'."""
    from db.models import TradeRecord

    if not db:
        return {"error": "Database session required"}

    trade = db.query(TradeRecord).filter(TradeRecord.id == trade_id).first()
    if not trade:
        return {"error": "Trade not found"}

    tx_hash = None

    if _is_blockchain_live() and TRADE_CONTRACT_ADDRESS and trade.contract_trade_id:
        try:
            w3, acct = _get_web3()
            contract = w3.eth.contract(
                address=w3.to_checksum_address(TRADE_CONTRACT_ADDRESS),
                abi=TRADE_ABI,
            )
            tx = contract.functions.confirmDelivery(
                trade.contract_trade_id,
            ).build_transaction({
                "from": acct.address,
                "nonce": w3.eth.get_transaction_count(acct.address),
                "gas": 200_000,
                "gasPrice": w3.eth.gas_price,
            })
            signed = acct.sign_transaction(tx)
            tx_hash_bytes = w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash_bytes, timeout=60)
            tx_hash = f"0x{receipt.transactionHash.hex()}"
        except Exception as exc:
            logger.error(f"On-chain delivery confirmation failed: {exc}")

    trade.status = "delivered"
    db.commit()
    db.refresh(trade)

    return {
        "trade_id": trade.id,
        "status": "delivered",
        "tx_hash": tx_hash,
        "farmer_status": "Delivery Confirmed ✅",
    }


def cancel_trade(trade_id: int, db=None) -> Dict[str, Any]:
    """Cancel a trade agreement."""
    from db.models import TradeRecord

    if not db:
        return {"error": "Database session required"}

    trade = db.query(TradeRecord).filter(TradeRecord.id == trade_id).first()
    if not trade:
        return {"error": "Trade not found"}

    if trade.status in ("delivered", "cancelled"):
        return {"error": f"Cannot cancel trade in '{trade.status}' status"}

    trade.status = "cancelled"
    db.commit()

    return {
        "trade_id": trade.id,
        "status": "cancelled",
        "farmer_status": "Deal Cancelled",
    }


def get_trade_status(trade_id: int, db=None) -> Dict[str, Any]:
    """Get farmer-friendly trade status."""
    from db.models import TradeRecord, SettlementRecord

    if not db:
        return {"error": "Database session required"}

    trade = db.query(TradeRecord).filter(TradeRecord.id == trade_id).first()
    if not trade:
        return {"error": "Trade not found"}

    # Get associated settlement
    settlement = db.query(SettlementRecord).filter(
        SettlementRecord.trade_id == trade_id
    ).first()

    # Map to farmer-friendly status
    STATUS_MAP = {
        "created": "Deal Created",
        "confirmed": "Deal Confirmed ✅",
        "delivered": "Delivery Confirmed ✅",
        "cancelled": "Deal Cancelled ❌",
        "disputed": "Under Review ⚠️",
    }

    SETTLEMENT_MAP = {
        "pending": "Payment Processing",
        "locked": "Payment Locked 🔒",
        "released": "Money Released 💰",
        "refunded": "Payment Refunded",
        "penalized": "Penalty Applied",
    }

    return {
        "trade_id": trade.id,
        "crop": trade.crop,
        "quantity_kg": trade.quantity_kg,
        "price_per_kg": trade.price_per_kg,
        "total_amount": trade.total_amount,
        "quality_grade": trade.quality_grade,
        "status": trade.status,
        "farmer_status": STATUS_MAP.get(trade.status, trade.status),
        "tx_hash": trade.tx_hash,
        "explorer_url": f"{POLYGONSCAN_BASE}/tx/{trade.tx_hash}" if trade.tx_hash else None,
        "settlement": {
            "status": settlement.status if settlement else "none",
            "farmer_status": SETTLEMENT_MAP.get(
                settlement.status, "Not Started"
            ) if settlement else "Not Started",
            "amount": settlement.amount if settlement else 0,
        } if settlement else None,
        "created_at": trade.created_at.isoformat() if trade.created_at else None,
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Service Functions — Settlement / Escrow
# ═══════════════════════════════════════════════════════════════════════════════


def lock_escrow(trade_id: int, db=None) -> Dict[str, Any]:
    """
    Lock funds in escrow for a trade.
    Farmer sees: "Payment Locked 🔒"
    """
    from db.models import TradeRecord, SettlementRecord

    if not db:
        return {"error": "Database session required"}

    trade = db.query(TradeRecord).filter(TradeRecord.id == trade_id).first()
    if not trade:
        return {"error": "Trade not found"}

    # Check if settlement already exists
    existing = db.query(SettlementRecord).filter(
        SettlementRecord.trade_id == trade_id
    ).first()
    if existing and existing.status != "pending":
        return {"error": f"Settlement already in '{existing.status}' state"}

    settlement = existing or SettlementRecord(
        trade_id=trade_id,
        amount=trade.total_amount,
        status="pending",
    )

    tx_hash = None

    if _is_blockchain_live() and SETTLEMENT_CONTRACT_ADDRESS and trade.contract_trade_id:
        try:
            w3, acct = _get_web3()
            contract = w3.eth.contract(
                address=w3.to_checksum_address(SETTLEMENT_CONTRACT_ADDRESS),
                abi=SETTLEMENT_ABI,
            )
            # Lock funds (value in wei — for demo, 1 wei per rupee)
            amount_wei = int(trade.total_amount)
            tx = contract.functions.lockFunds(
                trade.contract_trade_id,
            ).build_transaction({
                "from": acct.address,
                "value": amount_wei,
                "nonce": w3.eth.get_transaction_count(acct.address),
                "gas": 200_000,
                "gasPrice": w3.eth.gas_price,
            })
            signed = acct.sign_transaction(tx)
            tx_hash_bytes = w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash_bytes, timeout=60)
            tx_hash = f"0x{receipt.transactionHash.hex()}"
            settlement.block_number = receipt.blockNumber
        except Exception as exc:
            logger.error(f"Escrow lock failed: {exc}")

    settlement.status = "locked"
    settlement.escrow_tx_hash = tx_hash or compute_data_hash(
        {"lock": trade_id, "ts": str(datetime.now(timezone.utc))}
    )

    if not existing:
        db.add(settlement)
    db.commit()
    db.refresh(settlement)

    return {
        "settlement_id": settlement.id,
        "trade_id": trade_id,
        "amount": settlement.amount,
        "status": "locked",
        "farmer_status": "Payment Locked 🔒",
        "tx_hash": settlement.escrow_tx_hash,
        "explorer_url": f"{POLYGONSCAN_BASE}/tx/{settlement.escrow_tx_hash}" if settlement.escrow_tx_hash else None,
    }


def release_escrow(trade_id: int, db=None) -> Dict[str, Any]:
    """
    Release escrowed funds to seller after delivery confirmation.
    Farmer sees: "Money Released 💰"
    """
    from db.models import SettlementRecord

    if not db:
        return {"error": "Database session required"}

    settlement = db.query(SettlementRecord).filter(
        SettlementRecord.trade_id == trade_id
    ).first()
    if not settlement:
        return {"error": "No settlement found for this trade"}
    if settlement.status != "locked":
        return {"error": f"Cannot release — settlement is '{settlement.status}'"}

    tx_hash = None

    if _is_blockchain_live() and SETTLEMENT_CONTRACT_ADDRESS:
        try:
            w3, acct = _get_web3()
            contract = w3.eth.contract(
                address=w3.to_checksum_address(SETTLEMENT_CONTRACT_ADDRESS),
                abi=SETTLEMENT_ABI,
            )
            tx = contract.functions.releaseFunds(
                trade_id,
            ).build_transaction({
                "from": acct.address,
                "nonce": w3.eth.get_transaction_count(acct.address),
                "gas": 200_000,
                "gasPrice": w3.eth.gas_price,
            })
            signed = acct.sign_transaction(tx)
            tx_hash_bytes = w3.eth.send_raw_transaction(signed.raw_transaction)
            receipt = w3.eth.wait_for_transaction_receipt(tx_hash_bytes, timeout=60)
            tx_hash = f"0x{receipt.transactionHash.hex()}"
        except Exception as exc:
            logger.error(f"Escrow release failed: {exc}")

    settlement.status = "released"
    settlement.release_tx_hash = tx_hash or compute_data_hash(
        {"release": trade_id, "ts": str(datetime.now(timezone.utc))}
    )
    db.commit()
    db.refresh(settlement)

    return {
        "settlement_id": settlement.id,
        "trade_id": trade_id,
        "amount": settlement.amount,
        "status": "released",
        "farmer_status": "Money Released 💰",
        "tx_hash": settlement.release_tx_hash,
        "explorer_url": f"{POLYGONSCAN_BASE}/tx/{settlement.release_tx_hash}" if settlement.release_tx_hash else None,
    }


def apply_penalty(trade_id: int, db=None) -> Dict[str, Any]:
    """Apply penalty on trade default (late delivery / quality issue)."""
    from db.models import TradeRecord, SettlementRecord

    if not db:
        return {"error": "Database session required"}

    trade = db.query(TradeRecord).filter(TradeRecord.id == trade_id).first()
    settlement = db.query(SettlementRecord).filter(
        SettlementRecord.trade_id == trade_id
    ).first()

    if not trade or not settlement:
        return {"error": "Trade or settlement not found"}
    if settlement.status != "locked":
        return {"error": f"Cannot penalize — settlement is '{settlement.status}'"}

    penalty_amount = round(settlement.amount * (trade.penalty_rate / 100), 2)
    settlement.penalty_amount = penalty_amount
    settlement.status = "penalized"

    released_amount = settlement.amount - penalty_amount

    db.commit()
    db.refresh(settlement)

    return {
        "settlement_id": settlement.id,
        "trade_id": trade_id,
        "original_amount": settlement.amount,
        "penalty_amount": penalty_amount,
        "released_amount": released_amount,
        "penalty_rate": trade.penalty_rate,
        "status": "penalized",
        "farmer_status": f"Penalty ₹{penalty_amount} applied",
    }


def refund_escrow(trade_id: int, db=None) -> Dict[str, Any]:
    """Full refund of escrowed funds (trade cancelled)."""
    from db.models import SettlementRecord

    if not db:
        return {"error": "Database session required"}

    settlement = db.query(SettlementRecord).filter(
        SettlementRecord.trade_id == trade_id
    ).first()
    if not settlement:
        return {"error": "No settlement found"}
    if settlement.status not in ("locked", "pending"):
        return {"error": f"Cannot refund — settlement is '{settlement.status}'"}

    settlement.status = "refunded"
    db.commit()
    db.refresh(settlement)

    return {
        "settlement_id": settlement.id,
        "trade_id": trade_id,
        "amount": settlement.amount,
        "status": "refunded",
        "farmer_status": "Payment Refunded",
    }


# ═══════════════════════════════════════════════════════════════════════════════
# Query Functions
# ═══════════════════════════════════════════════════════════════════════════════


def get_user_trades(user_id: int, db=None) -> List[Dict[str, Any]]:
    """Get all trades for a user (as seller or buyer)."""
    from db.models import TradeRecord

    if not db:
        return []

    trades = db.query(TradeRecord).filter(
        (TradeRecord.seller_id == user_id) | (TradeRecord.buyer_id == user_id)
    ).order_by(TradeRecord.created_at.desc()).limit(50).all()

    STATUS_MAP = {
        "created": "Deal Created",
        "confirmed": "Deal Confirmed ✅",
        "delivered": "Delivery Confirmed ✅",
        "cancelled": "Deal Cancelled ❌",
        "disputed": "Under Review ⚠️",
    }

    results = []
    for t in trades:
        results.append({
            "trade_id": t.id,
            "crop": t.crop,
            "quantity_kg": t.quantity_kg,
            "price_per_kg": t.price_per_kg,
            "total_amount": t.total_amount,
            "quality_grade": t.quality_grade,
            "status": t.status,
            "farmer_status": STATUS_MAP.get(t.status, t.status),
            "role": "seller" if t.seller_id == user_id else "buyer",
            "tx_hash": t.tx_hash,
            "explorer_url": f"{POLYGONSCAN_BASE}/tx/{t.tx_hash}" if t.tx_hash else None,
            "created_at": t.created_at.isoformat() if t.created_at else None,
        })

    return results


def get_user_proofs(user_id: int, db=None) -> List[Dict[str, Any]]:
    """Get all recommendation proofs for a user."""
    from db.models import ProofRecord

    if not db:
        return []

    proofs = db.query(ProofRecord).filter(
        ProofRecord.user_id == user_id
    ).order_by(ProofRecord.created_at.desc()).limit(50).all()

    return [
        {
            "proof_id": p.id,
            "crop": p.crop,
            "region": p.region,
            "model_version": p.model_version,
            "status": p.status,
            "tx_hash": p.tx_hash,
            "explorer_url": f"{POLYGONSCAN_BASE}/tx/{p.tx_hash}" if p.tx_hash else None,
            "created_at": p.created_at.isoformat() if p.created_at else None,
        }
        for p in proofs
    ]


def get_blockchain_stats(user_id: int, db=None) -> Dict[str, Any]:
    """Dashboard stats: total proofs, trades, settlements."""
    from db.models import ProofRecord, TradeRecord, SettlementRecord

    if not db:
        return {"proofs": 0, "trades": 0, "settlements": 0, "total_volume": 0}

    proof_count = db.query(ProofRecord).filter(
        ProofRecord.user_id == user_id
    ).count()

    trade_count = db.query(TradeRecord).filter(
        (TradeRecord.seller_id == user_id) | (TradeRecord.buyer_id == user_id)
    ).count()

    settlements = db.query(SettlementRecord).join(
        TradeRecord, TradeRecord.id == SettlementRecord.trade_id
    ).filter(
        (TradeRecord.seller_id == user_id) | (TradeRecord.buyer_id == user_id)
    ).all()

    total_volume = sum(s.amount for s in settlements if s.status == "released")
    locked_amount = sum(s.amount for s in settlements if s.status == "locked")

    return {
        "proofs": proof_count,
        "trades": trade_count,
        "settlements": len(settlements),
        "total_volume": round(total_volume, 2),
        "locked_amount": round(locked_amount, 2),
        "blockchain_live": _is_blockchain_live(),
        "network": "Polygon PoS",
        "explorer_base": POLYGONSCAN_BASE,
    }
