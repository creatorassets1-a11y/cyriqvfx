import { redirect } from 'next/navigation';
export default async function Download({params}:{params:Promise<{slug:string}>}){ const {slug}=await params; redirect(`/api/resources/${encodeURIComponent(slug)}/download`); }
