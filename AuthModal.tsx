import React, { useState } from 'react';
import { SignIn, SignUp } from '@clerk/clerk-react';
import { X, ShieldCheck } from 'lucide-react';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'signIn' | 'signUp';
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose, initialMode = 'signIn' }) => {
  const [mode, setMode] = useState<'signIn' | 'signUp'>(initialMode);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[var(--overlay-backdrop)] backdrop-blur-md p-4 animate-in fade-in duration-200">
      <div className="relative hev-card-v2 border border-[var(--border-subtle)] rounded-[18px] max-w-md w-full p-6 shadow-2xl space-y-4 overflow-hidden">
        {/* Close Button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 text-[var(--text-secondary)] hover:text-[var(--text-primary)] p-2 rounded-full hover:bg-[var(--bg-surface)] transition-all cursor-pointer z-20"
        >
          <X className="w-5 h-5" />
        </button>

        {/* Modal Header */}
        <div className="text-center space-y-1">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-accent/10 border border-accent/20 text-accent text-[10px] font-bold tracking-wider uppercase mb-1">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Terminal Authentication</span>
          </div>
          <h2 className="text-base font-black text-[var(--text-primary)] tracking-tight">
            {mode === 'signIn' ? 'Masuk ke HEVORA Terminal' : 'Daftar Akun HEVORA'}
          </h2>
          <p className="text-[11px] text-[var(--text-secondary)]">
            Akses sinyal trading real-time, analisis grafik, dan kalender ekonomi.
          </p>
        </div>

        {/* Clerk Sign In / Sign Up component */}
        <div className="flex justify-center py-1">
          {mode === 'signIn' ? (
            <SignIn
              routing="virtual"
              appearance={{
                elements: {
                  rootBox: 'w-full',
                  card: 'shadow-none bg-transparent p-0 w-full',
                  headerTitle: 'hidden',
                  headerSubtitle: 'hidden',
                  socialButtonsBlockButton: 'border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-surface)] font-bold text-xs',
                  formButtonPrimary: 'bg-success hover:bg-success/90 text-black font-extrabold text-xs py-2.5',
                  footerActionLink: 'text-accent hover:text-accent/80 font-bold',
                },
              }}
            />
          ) : (
            <SignUp
              routing="virtual"
              appearance={{
                elements: {
                  rootBox: 'w-full',
                  card: 'shadow-none bg-transparent p-0 w-full',
                  headerTitle: 'hidden',
                  headerSubtitle: 'hidden',
                  socialButtonsBlockButton: 'border border-[var(--border-subtle)] text-[var(--text-primary)] hover:bg-[var(--bg-surface)] font-bold text-xs',
                  formButtonPrimary: 'bg-success hover:bg-success/90 text-black font-extrabold text-xs py-2.5',
                  footerActionLink: 'text-accent hover:text-accent/80 font-bold',
                },
              }}
            />
          )}
        </div>

        {/* Toggle Mode Footer */}
        <div className="text-center pt-3 border-t border-[var(--border-subtle)] text-[11px] text-[var(--text-secondary)]">
          {mode === 'signIn' ? (
            <span>
              Belum punya akun?{' '}
              <button
                onClick={() => setMode('signUp')}
                className="text-accent hover:underline font-bold cursor-pointer"
              >
                Daftar sekarang
              </button>
            </span>
          ) : (
            <span>
              Sudah punya akun?{' '}
              <button
                onClick={() => setMode('signIn')}
                className="text-accent hover:underline font-bold cursor-pointer"
              >
                Masuk di sini
              </button>
            </span>
          )}
        </div>
      </div>
    </div>
  );
};
