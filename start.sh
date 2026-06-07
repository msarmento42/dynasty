#!/bin/bash
python3 -m uvicorn backend.main:app --port 8001 &
cd frontend && npm run dev
