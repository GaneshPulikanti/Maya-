import requests
import json
import time
import os

token = os.popen('cat frontend/src/context/ChatContext.jsx | grep -o "localStorage.getItem.*" | head -n 1').read()
# We don't have the token directly, let's just make a script that uses the python db connection!

