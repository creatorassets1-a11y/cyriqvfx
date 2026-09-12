import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title:'Cyriq VFX — Free Resources for Editors', description:'Free scenepacks, presets, LUTs, VFX, sounds and editing resources.' };
export default function RootLayout({children}:{children:React.ReactNode}) { return <html lang="en"><body>{children}</body></html>; }
