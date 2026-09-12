import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = searchParams.get('q')?.trim() ?? '';
  const category = searchParams.get('category')?.trim() ?? '';
  const sort = searchParams.get('sort') === 'popular' ? 'downloads' : 'created_at';
  const supabase = await createClient();
  let query = supabase.from('resources').select('id,slug,title,description,category_id,tags,software,version,file_name,file_size,mime_type,thumbnail_url,preview_url,license,featured,downloads,created_at,categories(name,slug)').eq('published', true).order(sort,{ascending:false}).limit(48);
  if (q) query = query.or(`title.ilike.%${q}%,description.ilike.%${q}%`);
  if (category) query = query.eq('categories.slug', category);
  const { data, error } = await query;
  if (error) return NextResponse.json({ error: 'Unable to load resources' }, { status: 500 });
  return NextResponse.json({ resources: data ?? [] }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } });
}
