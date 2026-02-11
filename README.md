# Oligool

Multiple Sequence Alignment Viewer using React, FastAPI, and MAFFT.

## Prerequisites
- Node.js
- Python 3.8+
- MAFFT (`brew install mafft`)

## Running the Application

### 1. Backend (API)
Start the FastAPI server:
```bash
# From the project root (/Volumes/T7/Oligool)
uvicorn backend.main:app --host 0.0.0.0 --port 8000 --reload
```
The API will be available at `http://localhost:8000`.

### 2. Frontend (UI)
Start the React development server:
```bash
# From the project root
cd frontend
npm run dev
```
Open your browser to `http://localhost:5173`.
