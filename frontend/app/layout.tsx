import type { Metadata } from 'next';
import './globals.css';
export const metadata:Metadata={title:'Cyriq VFX — Free resources for editors',description:'Free scenepacks, presets, LUTs, VFX, sound effects, After Effects tools and project files.',metadataBase:new URL(process.env.NEXT_PUBLIC_SITE_URL||'http://localhost:3000'),icons:{icon:'/icon.svg'}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="en"><body>{children}</body></html>}
