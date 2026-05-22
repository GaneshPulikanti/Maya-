import React, { useState } from 'react'
import { useAuth } from '../context/AuthContext'
import { Heart, Mail, Lock, AlertCircle, ArrowRight } from 'lucide-react'

export default function Auth() {
  const { login, signup } = useAuth()
  const [isLogin, setIsLogin] = useState(true)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!email || !password) {
      setError("Please fill out all fields.")
      return
    }
    setError("")
    setLoading(true)

    try {
      if (isLogin) {
        await login(email, password)
      } else {
        await signup(email, password)
      }
    } catch (err) {
      setError(err.message || "An authentication error occurred.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-full flex items-center justify-center bg-wine-950 px-4 relative overflow-hidden">
      {/* Background Decorative Ambient Gradients */}
      <div className="absolute top-[-20%] left-[-20%] w-[60%] h-[60%] rounded-full bg-rose-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-20%] right-[-20%] w-[60%] h-[60%] rounded-full bg-rose-300/5 blur-[120px] pointer-events-none" />

      {/* Main Glass Card */}
      <div className="w-full max-w-md glass-card rounded-2xl p-8 relative z-10 glass-glow-rose border border-rose-500/20">
        
        {/* App Logo & Header */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-14 h-14 rounded-full bg-rose-500/20 flex items-center justify-center border border-rose-500/40 mb-3 animate-emotional-pulse">
            <Heart className="w-7 h-7 text-rose-300 fill-transparent" />
          </div>
          <h1 className="text-4xl font-bold font-sans tracking-tight text-butter-50">Maya</h1>
          <p className="text-butter-100/90 text-sm mt-1 text-center font-light">
            Your empathetic, caring, and thoughtful AI companion
          </p>
        </div>

        {/* Display Error Message */}
        {error && (
          <div className="mb-6 flex items-start gap-2.5 bg-rose-500/10 border border-rose-500/30 rounded-lg p-3 text-rose-300 text-sm animate-bubble-entry">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{error}</span>
          </div>
        )}

        {/* Form Inputs */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-butter-200 text-sm font-medium mb-1.5 font-sans" htmlFor="email">
              Email Address
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-butter-300 pointer-events-none">
                <Mail className="w-4 h-4" />
              </span>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl rose-input font-sans text-sm"
                required
              />
            </div>
          </div>

          <div>
            <label className="block text-butter-200 text-sm font-medium mb-1.5 font-sans" htmlFor="password">
              Password
            </label>
            <div className="relative">
              <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-butter-300 pointer-events-none">
                <Lock className="w-4 h-4" />
              </span>
              <input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl rose-input font-sans text-sm"
                required
              />
            </div>
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-rose-500 hover:bg-rose-400 text-wine-900 font-sans font-bold py-3 rounded-xl transition-all duration-300 hover:shadow-lg hover:shadow-rose-500/20 flex items-center justify-center gap-2 group disabled:opacity-50 disabled:pointer-events-none mt-2"
          >
            {loading ? (
              <span className="flex items-center gap-2">
                <span className="w-4 h-4 border-2 border-butter-100 border-t-transparent rounded-full animate-spin" />
                Processing...
              </span>
            ) : (
              <>
                <span>{isLogin ? "Enter Maya's World" : "Create My Companion"}</span>
                <ArrowRight className="w-4 h-4 group-hover:translate-x-0.5 transition-transform" />
              </>
            )}
          </button>
        </form>

        {/* Toggle link */}
        <div className="mt-8 pt-6 border-t border-wine-800 text-center">
          <p className="text-butter-300 text-sm font-light">
            {isLogin ? "New to Maya's sanctuary?" : "Already met your companion?"}{" "}
            <button
              onClick={() => {
                setIsLogin(!isLogin)
                setError("")
              }}
              className="text-rose-300 hover:text-rose-200 font-medium transition-colors hover:underline"
            >
              {isLogin ? "Join now" : "Sign in here"}
            </button>
          </p>
        </div>
      </div>
    </div>
  )
}
