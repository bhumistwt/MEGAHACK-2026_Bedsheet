# Khetwala

Khetwala is a platform focused on building digital tools that help farmers with access to information, resources, and decision support.
This repository currently contains the mobile application and backend foundation.

## Project Structure

- `khetwala-app/` – Mobile application
- `khetwala-backend/` – Backend services

## Android USB Backend Setup

The Android app already defaults to `http://localhost:8000`. For a physical device over USB, route that port through ADB instead of using a LAN IP.

1. Start the backend:
   - `d:/MEGAHACK-2026_Bedsheet/.venv-1/Scripts/python.exe -m uvicorn --app-dir D:/MEGAHACK-2026_Bedsheet/khetwala-backend main:app --host 0.0.0.0 --port 8000`
2. Connect the phone with USB debugging enabled.
3. From `khetwala-app`, run:
   - `npm run usb:backend`
4. Launch the app on Android.

Notes:

- `khetwala-app/.env` should keep `EXPO_PUBLIC_BACKEND_URL=http://localhost:8000` for USB mode.
- If you switch to Wi-Fi testing later, replace that value with your computer's LAN IP instead.
