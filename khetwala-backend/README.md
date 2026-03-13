# Khetwala

Khetwala is a platform for building digital tools that support farmers with better access to information, resources, and decision support.
It combines a mobile app experience with backend services for core workflows.

## Project Structure

- `khetwala-app/` – Mobile application
- `khetwala-backend/` – Backend services

## Run locally

1. Install dependencies:
   - `pip install -r requirements.txt`
2. Start server:
   - `uvicorn main:app --reload --host 0.0.0.0 --port 8000`

## AI Voice Calling Agent

The backend now includes a phone-based AI assistant that can work without the mobile app.

### Capabilities

- Inbound and outbound phone call support
- Voice to text + text to speech call flow
- Language support: `en`, `hi`, `kn`, `mr`, `gu`
- AI tool-calling across project feature APIs (weather, market, advisory, schemes, diary, marketplace, IoT, etc.)
- Dynamic API catalog from FastAPI OpenAPI so newly added backend features are automatically callable
- Human operator escalation when automation cannot complete a request
- Full call + transcript logging for dashboard APIs
- No-key fallback mode for core voice tasks (weather, mandi prices, schemes, soil health, credit score)
- Continuous call conversation loop with Twilio Gather (`Listen -> Understand -> Respond -> Listen`)
- Silence retry handling with optional operator transfer after repeated no-input

### Required environment variables

- `GOOGLE_API_KEY`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `VOICE_AGENT_PUBLIC_BASE_URL` (public URL reachable by Twilio)

### Optional environment variables

- `VOICE_AGENT_INTERNAL_API_BASE_URL` (defaults to public base URL)
- `VOICE_AGENT_FEATURE_TIMEOUT_SECONDS` (default: `12`)
- `VOICE_AGENT_HUMAN_OPERATOR_NUMBER` (used for call transfer)
- `VOICE_AGENT_MAX_SILENCE_RETRIES` (default: `2`)

### Key endpoints

- `POST /voice-agent/call/outbound`
- `POST /voice-agent/webhook/incoming`
- `POST /voice-agent/webhook/process`
- `POST /voice-agent/webhook/status`
- `POST /voice-agent/simulate`
- `GET /voice-agent/feature-catalog`
- `GET /voice-agent/dashboard/calls`
- `GET /voice-agent/dashboard/overview`

### End-to-end quickstart (working setup)

1. Start backend from workspace root:
   - `d:/MEGAHACK-2026_Bedsheet/.venv-1/Scripts/python.exe -m uvicorn --app-dir D:/MEGAHACK-2026_Bedsheet/khetwala-backend main:app --host 0.0.0.0 --port 8000`
2. If port `8000` is busy:
   - `Get-NetTCPConnection -LocalPort 8000 -State Listen | Select-Object OwningProcess`
   - `Stop-Process -Id <PID> -Force`
3. Start ngrok tunnel:
   - `ngrok http 8000`
4. Set public webhook base URL in `.env`:
   - `VOICE_AGENT_PUBLIC_BASE_URL=https://<your-ngrok-subdomain>.ngrok-free.app`
5. Configure Twilio Voice webhook for your phone number:
   - URL: `https://<your-ngrok-subdomain>.ngrok-free.app/voice-agent/webhook/incoming`
   - Method: `POST`
6. Optional operator handoff:
   - `VOICE_AGENT_HUMAN_OPERATOR_NUMBER=+91XXXXXXXXXX`

### Smoke tests

- Health: `GET /health`
- Feature catalog: `GET /voice-agent/feature-catalog`
- Simulate voice query:
  - `POST /voice-agent/simulate`
  - Body: `{"language_code":"hi","user_id":1,"text":"aaj ka mausam batao"}`

### Behavior without external keys

- Without `GOOGLE_API_KEY`, voice agent still works in fallback mode for:
  - weather, mandi prices, schemes, soil health, credit score
- Without Twilio keys, inbound/outbound real calling is disabled, but `/voice-agent/simulate` and dashboard logging continue to work.
