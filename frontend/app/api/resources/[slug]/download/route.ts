import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { presignDownload } from '@/lib/r2';
import { createHash } from 'node:crypto';

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const supabase = await createClient();
  const { data: resource } = await supabase.from('resources').select('id,file_key,file_name,published').eq('slug', slug).single();
  if (!resource || !resource.published) return NextResponse.json({ error:'Not found' }, { status:404 });
  const ip = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
  const ipHash = createHash('sha256').update(`${process.env.DOWNLOAD_SALT ?? 'cyriqvfx'}:${ip}`).digest('hex');
  const { data:{ user } } = await supabase.auth.getUser();
  await supabase.from('downloads').insert({ resource_id: resource.id, user_id: user?.id ?? null, ip_hash: ipHash, user_agent: request.headers.get('user-agent')?.slice(0,500) ?? null });
  await supabase.rpc('bump_download_count', { resource: resource.id });
  const url = await presignDownload(resource.file_key, resource.file_name);
  return NextResponse.redirect(url, 302);
}
