import Link from 'next/link';
import { ArrowUpRight, Download, Layers3, Sparkles } from 'lucide-react';

const categories = [['Scenepacks','scenepacks'],['After Effects','after-effects'],['Presets','presets'],['LUTs','luts'],['Sound Effects','sound-effects'],['VFX','vfx'],['Overlays','overlays'],['Tutorials','tutorials']];
const featured = [
  ['Cinematic Anime Scenepack','Scenepacks','Ready-to-use clips for high-energy anime edits'],
  ['Velocity Blur Essentials','Presets','Clean motion presets for fast-paced edits'],
  ['Midnight Film LUTs','LUTs','A restrained cinematic colour set'],
];

export default function Home() {
  return <main>
    <header className="site-header"><Link href="/" className="brand">CYRIQ<span>VFX</span></Link><nav><Link href="/resources">Resources</Link><Link href="/categories">Categories</Link></nav><Link href="/admin/login" className="creator-link">Creator Studio <ArrowUpRight size={15}/></Link></header>
    <section className="hero container">
      <div className="eyebrow"><Sparkles size={14}/> FREE RESOURCES FOR EDITORS</div>
      <h1>Build better edits.<br/><em>Take less time.</em></h1>
      <p>Scenepacks, presets, LUTs, VFX, sounds, scripts and project files — published by a video editor, free for everyone.</p>
      <form action="/resources" className="search"><input name="q" placeholder="Search resources..." aria-label="Search resources"/><button>Search</button></form>
      <div className="hero-links"><Link href="/resources">Browse everything <ArrowUpRight size={16}/></Link><span>•</span><span>No account required</span></div>
    </section>
    <section className="container section"><div className="section-head"><div><span className="kicker">EXPLORE</span><h2>Find your next asset.</h2></div><Link href="/categories" className="text-link">All categories <ArrowUpRight size={15}/></Link></div><div className="category-grid">{categories.map(([name,slug],i)=><Link href={`/categories/${slug}`} key={slug} className="category-row"><span>{String(i+1).padStart(2,'0')}</span><strong>{name}</strong><ArrowUpRight size={18}/></Link>)}</div></section>
    <section className="container section"><div className="section-head"><div><span className="kicker">LATEST</span><h2>Fresh from the studio.</h2></div><Link href="/resources" className="text-link">See all <ArrowUpRight size={15}/></Link></div><div className="resource-grid">{featured.map(([title,cat,desc])=><article className="resource-card" key={title}><div className="resource-art"><Layers3 size={22}/><span>PREVIEW</span></div><div className="resource-meta"><span>{cat}</span><span><Download size={13}/> Free</span></div><h3>{title}</h3><p>{desc}</p><Link href="/resources" className="card-link">Open resource <ArrowUpRight size={14}/></Link></article>)}</div></section>
    <footer className="footer container"><div><div className="brand">CYRIQ<span>VFX</span></div><p>Free tools and assets for people who make things.</p></div><div className="footer-links"><Link href="/resources">Resources</Link><Link href="/categories">Categories</Link><Link href="/admin/login">Creator</Link></div><small>© 2026 Cyriq VFX</small></footer>
  </main>;
}
