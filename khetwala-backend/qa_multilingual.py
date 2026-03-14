import argparse
import json
import uuid
from dataclasses import dataclass
from typing import Dict, List, Tuple

import requests


LANG_CASES = {
    "en": {
        "voice": "What is the weather in Nashik today?",
        "chat": "Give me mandi price advice for onion.",
    },
    "hi": {
        "voice": "आज नाशिक का मौसम कैसा है?",
        "chat": "प्याज के लिए मंडी भाव की सलाह दो।",
    },
    "mr": {
        "voice": "आज नाशिकचे हवामान कसे आहे?",
        "chat": "कांद्याच्या बाजारभावाबद्दल सल्ला दे.",
    },
    "gu": {
        "voice": "આજે નાશિકમાં હવામાન કેમ છે?",
        "chat": "ડુંગળીના બજાર ભાવ માટે સલાહ આપો.",
    },
    "kn": {
        "voice": "ಇಂದು ನಾಶಿಕ್ ಹವಾಮಾನ ಹೇಗಿದೆ?",
        "chat": "ಈರುಳ್ಳಿ ಮಾರುಕಟ್ಟೆ ಬೆಲೆ ಬಗ್ಗೆ ಸಲಹೆ ನೀಡಿ.",
    },
}


def detect_lang(text: str, fallback: str = "en") -> str:
    sample = (text or "").strip()
    if not sample:
        return fallback

    devanagari = sum(1 for ch in sample if "\u0900" <= ch <= "\u097F")
    gujarati = sum(1 for ch in sample if "\u0A80" <= ch <= "\u0AFF")
    kannada = sum(1 for ch in sample if "\u0C80" <= ch <= "\u0CFF")

    if kannada > 0 and kannada >= max(devanagari, gujarati):
        return "kn"
    if gujarati > 0 and gujarati >= max(devanagari, kannada):
        return "gu"

    if devanagari > 0:
        marathi_tokens = ["आहे", "नाही", "काय", "माझ", "कापणी", "पाऊस"]
        return "mr" if any(token in sample for token in marathi_tokens) else "hi"

    return "en"


@dataclass
class CheckResult:
    endpoint: str
    lang: str
    ok: bool
    source: str
    reply: str
    detected: str
    error: str = ""


def check_voice(base_url: str, lang: str, text: str, timeout: int) -> CheckResult:
    url = f"{base_url.rstrip('/')}/voice-agent/simulate"
    payload = {
        "call_sid": f"qa-{lang}-{uuid.uuid4().hex[:10]}",
        "language_code": lang,
        "text": text,
    }
    try:
        res = requests.post(url, json=payload, timeout=timeout)
        if res.status_code >= 400:
            return CheckResult("voice", lang, False, "http_error", "", "", f"{res.status_code} {res.text[:200]}")
        data = res.json()
        reply = (data.get("reply_text") or "").strip()
        detected = detect_lang(reply, "en")
        ok = bool(reply) and detected == lang
        return CheckResult("voice", lang, ok, "simulate", reply, detected, "" if ok else "reply empty or language mismatch")
    except Exception as exc:
        return CheckResult("voice", lang, False, "exception", "", "", str(exc))


def check_chat(base_url: str, lang: str, text: str, timeout: int) -> CheckResult:
    url = f"{base_url.rstrip('/')}/aria/chat"
    payload = {
        "messages": [{"role": "user", "text": text}],
        "context": {
            "crop": "Onion",
            "district": "Nashik",
            "risk_category": "medium",
            "last_recommendation": "wait",
            "negotiate_intent": False,
            "negotiate_crop": "Onion",
        },
        "language_code": lang,
    }
    try:
        res = requests.post(url, json=payload, timeout=timeout)
        if res.status_code >= 400:
            return CheckResult("chat", lang, False, "http_error", "", "", f"{res.status_code} {res.text[:200]}")
        data = res.json()
        reply = (data.get("reply") or "").strip()
        source = data.get("source", "unknown")
        returned_lang = data.get("language_code", "")
        detected = detect_lang(reply, "en")
        ok = bool(reply) and (returned_lang == lang) and (detected == lang)
        err = "" if ok else f"reply empty or mismatch (returned_lang={returned_lang}, detected={detected})"
        return CheckResult("chat", lang, ok, source, reply, detected, err)
    except Exception as exc:
        return CheckResult("chat", lang, False, "exception", "", "", str(exc))


def run_suite(base_url: str, timeout: int) -> Tuple[List[CheckResult], Dict[str, int]]:
    results: List[CheckResult] = []
    for lang, prompts in LANG_CASES.items():
        results.append(check_voice(base_url, lang, prompts["voice"], timeout))
        results.append(check_chat(base_url, lang, prompts["chat"], timeout))

    summary = {
        "total": len(results),
        "passed": sum(1 for r in results if r.ok),
        "failed": sum(1 for r in results if not r.ok),
    }
    return results, summary


def main() -> int:
    parser = argparse.ArgumentParser(description="Khetwala multilingual QA for voice and ARIA chat")
    parser.add_argument("--base-url", default="http://127.0.0.1:8000", help="Backend base URL")
    parser.add_argument("--timeout", type=int, default=20, help="HTTP timeout in seconds")
    parser.add_argument("--json", action="store_true", help="Print JSON output")
    args = parser.parse_args()

    results, summary = run_suite(args.base_url, args.timeout)

    if args.json:
        print(
            json.dumps(
                {
                    "summary": summary,
                    "results": [r.__dict__ for r in results],
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    else:
        print(f"Summary: {summary['passed']}/{summary['total']} passed")
        for item in results:
            status = "PASS" if item.ok else "FAIL"
            print(f"[{status}] {item.endpoint.upper()} {item.lang} source={item.source} detected={item.detected}")
            if not item.ok:
                print(f"  error: {item.error}")
            if item.reply:
                print(f"  reply: {item.reply[:180]}")

    return 0 if summary["failed"] == 0 else 1


if __name__ == "__main__":
    raise SystemExit(main())
