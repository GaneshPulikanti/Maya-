import React, { createContext, useState, useEffect, useContext } from 'react'
import axios from 'axios'

const AuthContext = createContext(null)

// Create a configured Axios instance
// In production, VITE_API_URL should be set to your backend domain (e.g., https://your-backend.onrender.com)
export const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '', // Falls back to relative path (Vite proxy) in local dev
})

export const AuthProvider = ({ children }) => {
  const [user, setUser] = useState(null)
  const [token, setToken] = useState(localStorage.getItem('token'))
  const [loading, setLoading] = useState(true)

  // Configure Request Interceptors for Axios
  useEffect(() => {
    const interceptor = api.interceptors.request.use(
      (config) => {
        if (token) {
          config.headers.Authorization = `Bearer ${token}`
        }
        return config;
      },
      (error) => Promise.reject(error)
    )

    return () => {
      api.interceptors.request.eject(interceptor)
    }
  }, [token])

  // Load current user profile if token is present
  useEffect(() => {
    const initAuth = async () => {
      if (token) {
        try {
          const response = await api.get('/api/auth/me')
          setUser(response.data)
        } catch (error) {
          console.error("Session restoration failed:", error)
          // Only log out if the server explicitly returned 401 Unauthorized (invalid/expired token).
          // Network connection delays or temporary server issues preserve the stored token.
          if (error.response?.status === 401) {
            logout()
          }
        }
      }
      setLoading(false)
    }
    initAuth()
  }, [token])

  const getErrorMessage = (error, defaultMsg) => {
    const detail = error.response?.data?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) return detail.map(e => e.msg || JSON.stringify(e)).join(', ');
    return defaultMsg;
  }

  const signup = async (email, password) => {
    try {
      const response = await api.post('/api/auth/signup', { email, password })
      // Auto login after successful signup
      return await login(email, password)
    } catch (error) {
      throw new Error(getErrorMessage(error, "Registration failed. Try again."))
    }
  }

  const login = async (email, password) => {
    try {
      const response = await api.post('/api/auth/login', { email, password })

      const { access_token } = response.data
      localStorage.setItem('token', access_token)
      sessionStorage.setItem('just_logged_in', 'true')
      setToken(access_token)
      
      // Fetch user profile
      const userProfile = await api.get('/api/auth/me', {
        headers: {
          Authorization: `Bearer ${access_token}`
        }
      })
      setUser(userProfile.data)
      return userProfile.data
    } catch (error) {
      throw new Error(getErrorMessage(error, "Invalid login credentials."))
    }
  }

  const logout = () => {
    localStorage.removeItem('token')
    setToken(null)
    setUser(null)
  }

  return (
    <AuthContext.Provider value={{ user, token, loading, signup, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

export const useAuth = () => {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
