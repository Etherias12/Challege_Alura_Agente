import uvicorn
from dotenv import load_dotenv
import os

# Load environment variables from .env file in the backend directory
load_dotenv()

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    print(f"Starting server on http://localhost:{port}")
    # run with reload=True to auto-reload server on code modifications
    uvicorn.run("app.main:app", host="0.0.0.0", port=port, reload=True)
