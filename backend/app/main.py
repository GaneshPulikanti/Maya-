import logging
from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager

from app.config import settings
from app.database import engine, Base
from app.routes import auth, chat, memory, upload, vision, voice, debug, debug2, debug3, debug_recover, debug_sort

# Set up logging configuration
logging.basicConfig(
    level=logging.INFO if not settings.DEBUG else logging.DEBUG,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s"
)
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifecycle manager that handles server startup and shutdown operations.
    Automatically creates all relational tables on startup in Supabase/PostgreSQL.
    """
    logger.info("Initializing application server lifecycle...")
    
    # Verify/create tables asynchronously
    try:
        async with engine.begin() as conn:
            logger.info("Verifying PostgreSQL database tables...")
            await conn.run_sync(Base.metadata.create_all)
        logger.info("Database validation check passed. Tables established.")
    except Exception as e:
        logger.critical(f"FATAL: Database connection failed during startup initialization: {str(e)}")
        # Do not raise error to allow startup, but log it intensely for troubleshooting
        
    yield
    
    # Shutdown operations
    logger.info("Shutting down application server lifecycle...")
    await engine.dispose()
    logger.info("Database connections terminated cleanly.")


# Initialize FastAPI app
app = FastAPI(
    title="AI Companion Chatbot Core Services",
    description="Production-grade, asynchronous backend API powering Maya AI Companion.",
    version="1.0.0",
    debug=settings.DEBUG,
    lifespan=lifespan
)

# Setup CORS middleware to permit frontend interaction
# Allow origins matches typical Vite developments and local hosting configurations
origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:8080",
    "http://localhost",
    "capacitor://localhost",
]

# Add production frontend URL from environment variable if available
import os
frontend_url = os.getenv("FRONTEND_URL")
if frontend_url:
    # Handle comma-separated list of origins if multiple domains exist
    for url in frontend_url.split(","):
        origins.append(url.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register API Sub-routers
app.include_router(auth.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(memory.router, prefix="/api")
app.include_router(upload.router, prefix="/api")
app.include_router(vision.router, prefix="/api")
app.include_router(voice.router, prefix="/api")
app.include_router(debug.router, prefix="/api")
app.include_router(debug2.router, prefix="/api")
app.include_router(debug3.router, prefix="/api")
app.include_router(debug_recover.router, prefix="/api")
app.include_router(debug_sort.router, prefix="/api")

# Mount static uploads directory for pinning image files dynamically
import os
static_dir = os.path.join(os.path.dirname(os.path.dirname(__file__)), "static")
os.makedirs(os.path.join(static_dir, "uploads"), exist_ok=True)
app.mount("/api/static", StaticFiles(directory=static_dir), name="static")


# Base health check route
@app.get("/health", tags=["System Status"])
async def health_check():
    """
    Service health check endpoint to verify backend operational status.
    """
    return {
        "status": "operational",
        "version": app.version,
        "environment": settings.ENV,
        "llm_primary": settings.PRIMARY_LLM
    }
