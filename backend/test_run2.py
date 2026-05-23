with open("backend/app/main.py", "r") as f:
    content = f.read()
if "from app.routes import debug2" not in content:
    content = content.replace("from app.routes import auth, chat, memory, upload, vision, voice, debug", "from app.routes import auth, chat, memory, upload, vision, voice, debug, debug2")
    content = content.replace("app.include_router(debug.router, prefix=\"/api\")", "app.include_router(debug.router, prefix=\"/api\")\napp.include_router(debug2.router, prefix=\"/api\")")
    with open("backend/app/main.py", "w") as f:
        f.write(content)
