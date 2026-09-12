'use client';
import { FormEvent, useState } from 'react';
import { createBrowserClient } from '@supabase/ssr';
import Link from 'next/link';

const sb=()=>createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!);
export default function Login(){const [email,setEmail]=useState('');const [password,setPassword]=useState('');const [error,setError]=useState('');const [busy,setBusy]=useState(false);async function submit(e:FormEvent){e.preventDefault();setBusy(true);setError('');const {error}=await sb().auth.signInWithPassword({email,password});if(error)setError(error.message);else location.href='/admin';setBusy(false)}return <main className="auth"><Link href="/" className="brand">CYRIQ<span>VFX</span></Link><div className="auth-card"><span className="kicker">PRIVATE AREA</span><h1>Creator Studio</h1><p>Sign in to publish and manage your library.</p><form onSubmit={submit}><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required autoComplete="email"/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required autoComplete="current-password"/></label>{error&&<div className="error">{error}</div>}<button disabled={busy}>{busy?'Signing in…':'Sign in'}</button></form><Link href="/" className="back">← Back to library</Link></div></main>}
