import Link from 'next/link';
import { ArrowRight, Download, Film, Sparkles, Search, Play, Package, Palette, Wand2 } from 'lucide-react';

const resources = [
  {title:'Cinematic Anime Scenepack', category:'Scenepacks', meta:'4K · 120 clips', size:'1.8 GB', icon:Film, accent:'violet'},
  {title:'Velocity Blur Preset Pack', category:'Presets', meta:'After Effects', size:'42 MB', icon:Wand2, accent:'blue'},
  {title:'Midnight Film LUTs', category:'LUTs', meta:'12 cinematic LUTs', size:'18 MB', icon:Palette, accent:'amber'},
  {title:'Impact SFX Essentials', category:'Sound Effects', meta:'WAV · 80 sounds', size:'96 MB', icon:Package, accent:'rose'},
];

const categories = ['Scenepacks','Presets','LUTs','VFX','Sound Effects','After Effects','Overlays','Tutorials'];

export default function Home() {
  return <main>
    <section className="hero">
      <nav className="nav shell">
        <Link href="/" className="brand"><span className="brand-mark">C</span><span>CYRIQ<span className="muted">VFX</span></span></Link>
        <div className="nav-links"><Link href="/resources">Resources</Link><Link href="/categories">Categories</Link><Link href="/about">About</Link></div>
        <Link href="/admin/login" className="admin-link">Creator login</Link>
      </nav>
      <div className="hero-content shell">
        <div className="eyebrow"><Sparkles size={14}/> FREE RESOURCES FOR EDITORS</div>
        <h1>Make better edits.<br/><em>Download what you need.</em></h1>
        <p className="hero-copy">A growing library of scenepacks, presets, LUTs, VFX, sounds and tools — curated and uploaded by a video editor, for video editors.</p>
        <div className="search"><Search size={20}/><input placeholder="Search resources, presets, scenepacks..."/><kbd>⌘ K</kbd></div>
        <div className="hero-actions"><Link className="button primary" href="/resources">Explore resources <ArrowRight size={17}/></Link><Link className="button ghost" href="#latest">Latest uploads</Link></div>
      </div>
      <div className="hero-glow" />
    </section>

    <section className="shell section" id="latest">
      <div className="section-head"><div><span className="eyebrow small">THE LIBRARY</span><h2>Fresh for your timeline.</h2></div><Link href="/resources" className="text-link">View all <ArrowRight size={15}/></Link></div>
      <div className="resource-grid">{resources.map(r => <article className="resource-card" key={r.title}>
        <div className={`preview ${r.accent}`}><r.icon size={30}/><span className="preview-play"><Play size={13} fill="currentColor"/></span></div>
        <div className="card-body"><div className="card-category">{r.category}</div><h3>{r.title}</h3><div className="card-meta"><span>{r.meta}</span><span>{r.size}</span></div><Link href={`/resources/${r.title.toLowerCase().replaceAll(' ','-')}`} className="download"><Download size={15}/> Download free</Link></div>
      </article>)}</div>
    </section>

    <section className="shell section categories"><div className="section-head"><div><span className="eyebrow small">EXPLORE</span><h2>Find your next asset.</h2></div></div><div className="category-grid">{categories.map((c,i)=><Link href={`/categories/${c.toLowerCase().replaceAll(' ','-')}`} className="category" key={c}><span>{String(i+1).padStart(2,'0')}</span><b>{c}</b><ArrowRight size={16}/></Link>)}</div></section>
    <footer className="shell footer"><div className="brand"><span className="brand-mark">C</span><span>CYRIQVFX</span></div><span>Free tools & assets for editors.</span><span>© 2026 Cyriq VFX</span></footer>
  </main>
}
