from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv()
mongo_uri = os.getenv("MONGO_URI", "mongodb+srv://ganeshpulikanti7:wV9mNpsw8v03xLhC@cluster0.zox2r.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0")
client = MongoClient(mongo_uri)
db = client.chat_db

user = db.users.find_one({"email": "ganeshpulikanti7@gmail.com"})
if not user:
    print("User not found!")
else:
    user_id = str(user["_id"])
    print(f"User ID: {user_id}")
    
    print("\n--- Owned Sessions ---")
    owned = list(db.sessions.find({"user_id": user_id}))
    for s in owned:
        print(f"ID: {s['_id']}, Title: {s.get('title')}, Messages: {db.messages.count_documents({'session_id': str(s['_id'])})}")
        
    print("\n--- Shared Sessions ---")
    shared_entries = list(db.shared_sessions.find({"user_id": user_id}))
    for se in shared_entries:
        s = db.sessions.find_one({"_id": se["session_id"]})
        if s:
            print(f"ID: {s['_id']}, Title: {s.get('title')}, Owner: {s.get('user_id')}, Messages: {db.messages.count_documents({'session_id': str(s['_id'])})}")
        else:
            print(f"Session {se['session_id']} NOT FOUND for shared entry!")

print("\n--- Any other user with 'Group' or 'Shared' sessions ---")
all_sessions = list(db.sessions.find({"title": {"$regex": "(?i)group|shared"}}))
for s in all_sessions:
    print(f"ID: {s['_id']}, Title: {s.get('title')}, Owner: {s.get('user_id')}, Messages: {db.messages.count_documents({'session_id': str(s['_id'])})}")

