import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/auth';
import { createAdminClient } from '@/lib/supabase/admin';
export async function GET(){const user=await requireAdmin();if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});const supa=createAdminClient();const [{data:resources},{data:cats},{count:downloads}]=await Promise.all([supa.from('resources').select('id,slug,title,description,file_size,downloads,published,featured,created_at,categories(name)').order('created_at',{ascending:false}).limit(100),supa.from('categories').select('id,name,slug').order('name'),supa.from('downloads').select('id',{count:'exact',head:true})]);return NextResponse.json({resources:resources??[],categories:cats??[],downloads:downloads??0})}
