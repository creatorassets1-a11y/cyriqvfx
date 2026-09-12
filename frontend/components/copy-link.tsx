'use client';
import { ExternalLink } from 'lucide-react';
export default function CopyLink(){return <button className="secondary-btn" onClick={async()=>{try{await navigator.clipboard.writeText(window.location.href)}catch{}}}><ExternalLink size={15}/> Copy link</button>}
