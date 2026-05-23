import asyncio
import httpx

async def test():
    async with httpx.AsyncClient() as client:
        # Login
        data = {
            "username": "princeganna525@gmail.com",
            "password": "Password123!"
        }
        res = await client.post("http://localhost:8000/api/auth/login", data=data) # default httpx.post with data sends application/x-www-form-urlencoded
        if res.status_code != 200:
            print("Login failed:", res.status_code, res.text)
            return
            
        token = res.json()["access_token"]
        headers = {"Authorization": f"Bearer {token}"}
        
        # Get sessions
        res2 = await client.get("http://localhost:8000/api/chat/sessions", headers=headers)
        if res2.status_code != 200:
            print("Sessions failed:", res2.status_code, res2.text)
            return
            
        print("Success! Got", len(res2.json()), "sessions")

asyncio.run(test())
