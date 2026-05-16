"""FastAPI application entry point."""

from pathlib import Path

from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse

from spark.server.routes import router
from spark.server.admin_routes import router as admin_router

app = FastAPI(
    title="Spark Agent",
    description="Web interface for Spark Agent framework",
    version="0.1.0",
)

# Include WebSocket routes
app.include_router(router)

# Include admin API routes
app.include_router(admin_router)

STATIC_DIR = Path(__file__).parent / "static"


@app.get("/")
async def index():
    """Serve the chat UI."""
    index_path = STATIC_DIR / "index.html"
    if index_path.exists():
        return FileResponse(str(index_path))
    return {"error": "index.html not found"}


@app.get("/admin")
async def admin_dashboard():
    """Serve the admin dashboard."""
    admin_path = STATIC_DIR / "admin.html"
    if admin_path.exists():
        return FileResponse(str(admin_path))
    return {"error": "admin.html not found"}


# Mount static files (must be after route registrations)
if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


def run():
    """Run the server programmatically."""
    import uvicorn
    uvicorn.run("spark.server.app:app", host="0.0.0.0", port=8000, reload=True)
