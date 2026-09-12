import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(_: Request, context: { params: Promise<{ slug: string }> }) {
  const { slug } = await context.params;
  const supabase = await createClient();
  const { data, error } = await supabase.from('resources').select('id,slug,title,description,category_id,tags,software,version,file_name,file_size,mime_type,thumbnail_url,preview_url,license,featured,downloads,created_at,categories(name,slug)').eq('slug', slug).eq('published', true).single();
  if (error || !data) return NextResponse.json({ error:'Not found' },{status:404});
  return NextResponse.json({ resource:data }, { headers:{'Cache-Control':'public, s-maxage=60, stale-while-revalidate=300'} });
}
