import uuid
from datetime import datetime
from typing import Optional, List
from pydantic import BaseModel, EmailStr, Field, ConfigDict

# ==============================================================================
# USER SCHEMAS
# ==============================================================================

class UserCreate(BaseModel):
    """
    Schema for user signup request.
    Validates email format and ensures password meets minimum length requirements.
    """
    email: EmailStr
    password: str = Field(..., min_length=8, max_length=100, description="User password must be at least 8 characters long.")

class UserLogin(BaseModel):
    """
    Schema for user login request.
    """
    email: EmailStr
    password: str

class UserResponse(BaseModel):
    """
    Schema for returning user data.
    Hides internal secrets like hashed password.
    """
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    email: EmailStr
    created_at: datetime

# ==============================================================================
# TOKEN SCHEMAS
# ==============================================================================

class Token(BaseModel):
    """
    JWT Access Token response structure.
    """
    access_token: str
    token_type: str = "bearer"

class TokenData(BaseModel):
    """
    Decoded payload structure inside the JWT token.
    """
    user_id: Optional[uuid.UUID] = None

# ==============================================================================
# CHAT SCHEMAS
# ==============================================================================

class ChatSessionCreate(BaseModel):
    """
    Schema for creating a new conversation session.
    Title is optional (defaults to 'Conversation' if omitted).
    """
    title: Optional[str] = Field(None, max_length=100)

class ChatSessionResponse(BaseModel):
    """
    Response schema for a Chat Session.
    """
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    created_at: datetime
    updated_at: datetime
    participants: Optional[List[str]] = None
    shared_url: Optional[str] = None

class ChatMessageCreate(BaseModel):
    """
    Schema for sending a new message to a session.
    """
    content: str = Field(..., min_length=1, description="Message content cannot be empty.")

class ChatMessageResponse(BaseModel):
    """
    Response schema for returning saved messages.
    """
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    session_id: uuid.UUID
    role: str
    content: str
    created_at: datetime

# ==============================================================================
# PDF / DOCUMENT SCHEMAS
# ==============================================================================

class PDFDocumentResponse(BaseModel):
    """
    Schema for returning uploaded document info.
    """
    model_config = ConfigDict(from_attributes=True)
    
    id: uuid.UUID
    filename: str
    chroma_collection: str
    created_at: datetime
