import json
import uuid
from typing import Any, Dict, List, Optional

import httpx
from fastapi import HTTPException

from core.config import settings
from core.logging import get_logger

logger = get_logger('khetwala.services.llm')

GEMINI_CHAT_URL = (
    'https://generativelanguage.googleapis.com/v1beta/models/'
    'gemini-2.5-flash:generateContent'
)
GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions'
GROQ_AUDIO_URL = 'https://api.groq.com/openai/v1/audio/transcriptions'


def _provider_order() -> list[str]:
    preferred = (settings.llm_provider or 'groq').strip().lower()
    providers = ['groq', 'gemini'] if preferred != 'gemini' else ['gemini', 'groq']
    return [provider for provider in providers if _is_configured(provider)]


def _is_configured(provider: str) -> bool:
    if provider == 'groq':
        return bool((settings.groq_api_key or '').strip())
    if provider == 'gemini':
        return bool((settings.google_api_key or '').strip())
    return False


def active_text_provider() -> Optional[str]:
    providers = _provider_order()
    return providers[0] if providers else None


def _json_loads(raw: Any) -> dict:
    if isinstance(raw, dict):
        return raw
    if not raw:
        return {}
    try:
        return json.loads(raw)
    except Exception:
        return {'raw': raw}


def _openai_tools(tools: Optional[List[Dict[str, Any]]]) -> list:
    converted = []
    for tool in tools or []:
        converted.append(
            {
                'type': 'function',
                'function': {
                    'name': tool['name'],
                    'description': tool.get('description', ''),
                    'parameters': tool.get('parameters', {'type': 'object', 'properties': {}}),
                },
            }
        )
    return converted


def _groq_messages(system_prompt: str, messages: List[Dict[str, Any]]) -> list:
    payload = [{'role': 'system', 'content': system_prompt}]
    for message in messages:
        role = message.get('role', 'user')
        if role == 'tool':
            payload.append(
                {
                    'role': 'tool',
                    'tool_call_id': message.get('tool_call_id') or str(uuid.uuid4()),
                    'name': message.get('name', 'tool'),
                    'content': message.get('content', '{}'),
                }
            )
            continue

        if role == 'assistant' and message.get('tool_calls'):
            payload.append(
                {
                    'role': 'assistant',
                    'content': message.get('content') or '',
                    'tool_calls': [
                        {
                            'id': tool_call.get('id') or str(uuid.uuid4()),
                            'type': 'function',
                            'function': {
                                'name': tool_call.get('name', ''),
                                'arguments': json.dumps(tool_call.get('arguments', {}), ensure_ascii=False),
                            },
                        }
                        for tool_call in message.get('tool_calls', [])
                    ],
                }
            )
            continue

        payload.append({'role': role, 'content': message.get('content', '')})
    return payload


def _gemini_contents(messages: List[Dict[str, Any]]) -> list:
    contents = []
    for message in messages:
        role = message.get('role', 'user')
        if role == 'tool':
            contents.append(
                {
                    'role': 'user',
                    'parts': [
                        {
                            'functionResponse': {
                                'name': message.get('name', 'tool'),
                                'response': _json_loads(message.get('content')),
                            }
                        }
                    ],
                }
            )
            continue

        if role == 'assistant' and message.get('tool_calls'):
            parts = []
            if message.get('content'):
                parts.append({'text': message['content']})
            for tool_call in message.get('tool_calls', []):
                parts.append(
                    {
                        'functionCall': {
                            'name': tool_call.get('name', ''),
                            'args': tool_call.get('arguments', {}),
                        }
                    }
                )
            contents.append({'role': 'model', 'parts': parts or [{'text': ''}]})
            continue

        mapped_role = 'user' if role == 'user' else 'model'
        contents.append({'role': mapped_role, 'parts': [{'text': message.get('content', '') or ''}]})

    if not contents:
        contents.append({'role': 'user', 'parts': [{'text': '(start)'}]})
    return contents


def _normalize_groq_response(data: Dict[str, Any]) -> Dict[str, Any]:
    choice = ((data or {}).get('choices') or [{}])[0]
    message = choice.get('message') or {}
    tool_calls = []
    for tool_call in message.get('tool_calls') or []:
        function = tool_call.get('function') or {}
        tool_calls.append(
            {
                'id': tool_call.get('id') or str(uuid.uuid4()),
                'name': function.get('name', ''),
                'arguments': _json_loads(function.get('arguments')),
            }
        )
    return {
        'provider': 'groq',
        'content': (message.get('content') or '').strip(),
        'tool_calls': tool_calls,
        'raw': data,
    }


def _normalize_gemini_response(data: Dict[str, Any]) -> Dict[str, Any]:
    candidate = ((data or {}).get('candidates') or [{}])[0]
    parts = (candidate.get('content') or {}).get('parts') or []
    text_parts = []
    tool_calls = []
    for part in parts:
        if 'text' in part:
            text_parts.append(part['text'])
        if part.get('functionCall'):
            function_call = part['functionCall']
            tool_calls.append(
                {
                    'id': str(uuid.uuid4()),
                    'name': function_call.get('name', ''),
                    'arguments': function_call.get('args', {}),
                }
            )
    return {
        'provider': 'gemini',
        'content': '\n'.join(text_parts).strip(),
        'tool_calls': tool_calls,
        'raw': data,
    }


async def _call_groq_chat(
    system_prompt: str,
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]],
    temperature: float,
    max_output_tokens: int,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        'model': settings.groq_chat_model,
        'messages': _groq_messages(system_prompt, messages),
        'temperature': temperature,
        'max_tokens': max_output_tokens,
    }
    if tools:
        body['tools'] = _openai_tools(tools)
        body['tool_choice'] = 'auto'

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            GROQ_CHAT_URL,
            json=body,
            headers={
                'Authorization': f'Bearer {settings.groq_api_key}',
                'Content-Type': 'application/json',
            },
        )

    if resp.status_code != 200:
        logger.error('Groq chat error', status=resp.status_code, body=resp.text[:500])
        raise HTTPException(status_code=502, detail=f'Groq returned {resp.status_code}')

    return _normalize_groq_response(resp.json())


async def _call_gemini_chat(
    system_prompt: str,
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]],
    temperature: float,
    max_output_tokens: int,
) -> Dict[str, Any]:
    body: Dict[str, Any] = {
        'system_instruction': {'parts': [{'text': system_prompt}]},
        'contents': _gemini_contents(messages),
        'generationConfig': {
            'temperature': temperature,
            'maxOutputTokens': max_output_tokens,
        },
    }
    if tools:
        body['tools'] = [{'function_declarations': tools}]
        body['tool_config'] = {'function_calling_config': {'mode': 'AUTO'}}

    async with httpx.AsyncClient(timeout=30.0) as client:
        resp = await client.post(
            GEMINI_CHAT_URL,
            json=body,
            headers={
                'Content-Type': 'application/json',
                'x-goog-api-key': settings.google_api_key,
            },
        )

    if resp.status_code != 200:
        logger.error('Gemini chat error', status=resp.status_code, body=resp.text[:500])
        raise HTTPException(status_code=502, detail=f'Gemini returned {resp.status_code}')

    return _normalize_gemini_response(resp.json())


async def chat_completion(
    *,
    system_prompt: str,
    messages: List[Dict[str, Any]],
    tools: Optional[List[Dict[str, Any]]] = None,
    temperature: float = 0.4,
    max_output_tokens: int = 800,
) -> Dict[str, Any]:
    providers = _provider_order()
    if not providers:
        raise HTTPException(status_code=503, detail='No LLM provider configured')

    last_error: Optional[Exception] = None
    for provider in providers:
        try:
            if provider == 'groq':
                return await _call_groq_chat(system_prompt, messages, tools, temperature, max_output_tokens)
            return await _call_gemini_chat(system_prompt, messages, tools, temperature, max_output_tokens)
        except Exception as exc:
            last_error = exc
            logger.warning('LLM provider failed', provider=provider, error=str(exc))

    if isinstance(last_error, HTTPException):
        raise last_error
    raise HTTPException(status_code=502, detail='All LLM providers failed')


async def transcribe_audio(
    *,
    audio_bytes: bytes,
    file_name: str,
    mime_type: str,
    language_code: Optional[str] = None,
) -> Dict[str, str]:
    if not _is_configured('groq'):
        raise HTTPException(status_code=503, detail='Groq transcription unavailable — API key missing')

    data = {'model': settings.groq_audio_model}
    if language_code:
        data['language'] = language_code

    files = {
        'file': (file_name or 'aria-audio.m4a', audio_bytes, mime_type or 'audio/mp4'),
    }

    async with httpx.AsyncClient(timeout=60.0) as client:
        resp = await client.post(
            GROQ_AUDIO_URL,
            data=data,
            files=files,
            headers={'Authorization': f'Bearer {settings.groq_api_key}'},
        )

    if resp.status_code != 200:
        logger.error('Groq transcription error', status=resp.status_code, body=resp.text[:500])
        raise HTTPException(status_code=502, detail=f'Groq transcription returned {resp.status_code}')

    payload = resp.json()
    return {
        'provider': 'groq',
        'text': (payload.get('text') or '').strip(),
    }