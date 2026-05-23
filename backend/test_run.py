with open("backend/app/main.py", "r") as f:
    content = f.read()

if "from app.routes import debug" not in content:
    content = content.replace(
        "from app.routes import auth, chat, memory, upload, vision, voice",
        "from app.routes import auth, chat, memory, upload, vision, voice, debug"
    )
    content = content.replace(
        "app.include_router(voice.router, prefix=\"/api\")",
        "app.include_router(voice.router, prefix=\"/api\")\napp.include_router(debug.router, prefix=\"/api\")"
    )
    with open("backend/app/main.py", "w") as f:
        f.write(content)
