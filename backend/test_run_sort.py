with open("backend/app/main.py", "r") as f:
    content = f.read()
if "from app.routes import debug_sort" not in content:
    content = content.replace("from app.routes import auth, chat, memory, upload, vision, voice, debug, debug2, debug3, debug_recover", "from app.routes import auth, chat, memory, upload, vision, voice, debug, debug2, debug3, debug_recover, debug_sort")
    content = content.replace("app.include_router(debug_recover.router, prefix=\"/api\")", "app.include_router(debug_recover.router, prefix=\"/api\")\napp.include_router(debug_sort.router, prefix=\"/api\")")
    with open("backend/app/main.py", "w") as f:
        f.write(content)
