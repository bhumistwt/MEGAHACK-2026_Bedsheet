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